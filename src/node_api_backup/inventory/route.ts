import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import {
  adjustProductStock,
  applyStockChangeInTx,
  getInventoryValuation,
  transferWarehouseStock,
} from '@/lib/services/inventory.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { logAudit } from '@/lib/auth';

const ProductSchema = z.object({
  sku: z.string().min(2),
  barcode: z.string().optional().nullable(),
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  nameKu: z.string().min(2),
  description: z.string().optional().nullable(),
  categoryId: z.string().min(1),
  unit: z.string().default('PCS'),
  purchaseCostUsd: z.union([z.number(), z.string()]),
  sellingPriceUsd: z.union([z.number(), z.string()]),
  taxRate: z.union([z.number(), z.string()]).optional().default(0),
  minStockLevel: z.union([z.number(), z.string()]).optional().default(5),
  initialStock: z.union([z.number(), z.string()]).optional().default(0),
  warehouseId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    await requireApiPermission('inventory.view');
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const categoryId = searchParams.get('categoryId') || undefined;

    const [valuation, movements, transfers, categories, warehouses] = await Promise.all([
      getInventoryValuation({ warehouseId, categoryId }),
      prisma.inventoryMovement.findMany({
        take: 60,
        orderBy: { createdAt: 'desc' },
        include: { product: true, warehouse: true },
      }),
      prisma.stockTransfer.findMany({
        take: 40,
        orderBy: { createdAt: 'desc' },
        include: { product: true, fromWarehouse: true, toWarehouse: true },
      }),
      prisma.category.findMany({ orderBy: { nameEn: 'asc' } }),
      prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { isDefault: 'desc' } }),
    ]);

    return NextResponse.json({
      valuation,
      movements,
      transfers,
      categories,
      warehouses,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'createProduct') {
      const user = await requireApiPermission('inventory.manage');
      const parsed = ProductSchema.parse(body);

      const result = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            sku: parsed.sku.trim().toUpperCase(),
            barcode: parsed.barcode ? parsed.barcode.trim() : null,
            nameEn: parsed.nameEn.trim(),
            nameAr: parsed.nameAr.trim(),
            nameKu: parsed.nameKu.trim(),
            description: parsed.description || null,
            categoryId: parsed.categoryId,
            unit: parsed.unit,
            purchaseCostUsd: Number(parsed.purchaseCostUsd),
            sellingPriceUsd: Number(parsed.sellingPriceUsd),
            taxRate: Number(parsed.taxRate || 0),
            minStockLevel: Number(parsed.minStockLevel || 5),
            totalStock: 0,
          },
        });

        const initQty = Number(parsed.initialStock || 0);
        if (initQty > 0) {
          let whId = parsed.warehouseId;
          if (!whId) {
            const defWh =
              (await tx.warehouse.findFirst({ where: { isDefault: true } })) ||
              (await tx.warehouse.findFirst());
            whId = defWh?.id;
          }
          if (whId) {
            await applyStockChangeInTx(tx, {
              productId: product.id,
              warehouseId: whId,
              quantityDelta: initQty,
              type: 'OPENING_STOCK',
              unitCostUsd: Number(parsed.purchaseCostUsd),
              reason: 'Initial opening stock on product creation',
              postJournalForAdjustment: true,
              createdById: user.id,
            });
          }
        }

        return tx.product.findUnique({
          where: { id: product.id },
          include: { category: true, warehouseStocks: true },
        });
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PRODUCT_CREATED',
        module: 'INVENTORY',
        entityType: 'Product',
        entityId: result?.id,
        description: `Created product '${parsed.nameEn}' (SKU: ${parsed.sku})`,
      });

      return NextResponse.json({ product: result });
    }

    if (action === 'updateProduct') {
      const user = await requireApiPermission('inventory.manage');
      const { id, nameEn, nameAr, nameKu, sku, barcode, categoryId, unit, purchaseCostUsd, sellingPriceUsd, minStockLevel } = body;

      const updated = await prisma.product.update({
        where: { id },
        data: {
          nameEn,
          nameAr: nameAr || nameEn,
          nameKu: nameKu || nameEn,
          sku,
          barcode: barcode || null,
          categoryId,
          unit,
          purchaseCostUsd: Number(purchaseCostUsd),
          sellingPriceUsd: Number(sellingPriceUsd),
          minStockLevel: Number(minStockLevel),
        },
        include: { category: true, warehouseStocks: true },
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PRODUCT_UPDATED',
        module: 'INVENTORY',
        entityType: 'Product',
        entityId: updated.id,
        description: `Updated product '${updated.nameEn}' (${updated.sku})`,
      });

      return NextResponse.json({ product: updated });
    }

    if (action === 'adjustStock') {
      const user = await requireApiPermission('inventory.adjust');
      const { productId, warehouseId, quantityDelta, reason, allowNegativeStock } = body;

      const res = await adjustProductStock({
        productId,
        warehouseId,
        quantityDelta: Number(quantityDelta),
        reason: reason || 'Manual stock adjustment',
        allowNegativeStock: Boolean(allowNegativeStock),
        userId: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'STOCK_ADJUSTED',
        module: 'INVENTORY',
        entityType: 'Product',
        entityId: productId,
        description: `Adjusted stock by ${quantityDelta} units — Reason: ${reason}`,
      });

      return NextResponse.json(res);
    }

    if (action === 'transferStock') {
      const user = await requireApiPermission('inventory.transfer');
      const { productId, fromWarehouseId, toWarehouseId, quantity, notes } = body;

      const transfer = await transferWarehouseStock({
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity: Number(quantity),
        notes,
        userId: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'STOCK_TRANSFERRED',
        module: 'INVENTORY',
        entityType: 'StockTransfer',
        entityId: transfer.id,
        description: `Transferred ${quantity} units of ${transfer.product.nameEn} from ${transfer.fromWarehouse.nameEn} to ${transfer.toWarehouse.nameEn}`,
      });

      return NextResponse.json({ transfer });
    }

    if (action === 'createCategory') {
      const user = await requireApiPermission('inventory.manage');
      const { code, nameEn, nameAr, nameKu, description } = body;
      const cat = await prisma.category.create({
        data: {
          code: (code || `CAT-${Date.now().toString().slice(-4)}`).toUpperCase(),
          nameEn,
          nameAr: nameAr || nameEn,
          nameKu: nameKu || nameEn,
          description: description || null,
        },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'CATEGORY_CREATED',
        module: 'INVENTORY',
        entityType: 'Category',
        entityId: cat.id,
        description: `Created product category '${cat.nameEn}'`,
      });
      return NextResponse.json({ category: cat });
    }

    if (action === 'createWarehouse') {
      const user = await requireApiPermission('inventory.manage');
      const { code, nameEn, nameAr, nameKu, location, managerName, phone } = body;
      const wh = await prisma.warehouse.create({
        data: {
          code: (code || `WH-${Date.now().toString().slice(-4)}`).toUpperCase(),
          nameEn,
          nameAr: nameAr || nameEn,
          nameKu: nameKu || nameEn,
          location: location || null,
          managerName: managerName || null,
          phone: phone || null,
        },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'WAREHOUSE_CREATED',
        module: 'INVENTORY',
        entityType: 'Warehouse',
        entityId: wh.id,
        description: `Created warehouse '${wh.nameEn}'`,
      });
      return NextResponse.json({ warehouse: wh });
    }

    return NextResponse.json({ error: 'Invalid inventory action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}

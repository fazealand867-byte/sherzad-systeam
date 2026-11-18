import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { D, DecimalValue, roundUsd } from '../decimal';
import { postJournalEntryInTx } from './accounting.service';

export class InventoryError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

export interface StockChangeInput {
  productId: string;
  warehouseId: string;
  quantityDelta: DecimalValue; // positive for adding stock, negative for deducting stock
  type:
    | 'PURCHASE_RECEIPT'
    | 'PURCHASE_RETURN'
    | 'SALE_DISPATCH'
    | 'SALE_RETURN'
    | 'ADJUSTMENT_IN'
    | 'ADJUSTMENT_OUT'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'OPENING_STOCK';
  unitCostUsd?: DecimalValue;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  allowNegativeStock?: boolean;
  postJournalForAdjustment?: boolean;
  createdById?: string | null;
  isDemo?: boolean;
}

/**
 * Updates product stock inside a transaction, enforces non-negative stock unless overridden,
 * records an InventoryMovement, and optionally posts an Inventory Adjustment journal entry.
 */
export async function applyStockChangeInTx(
  tx: Prisma.TransactionClient,
  input: StockChangeInput
) {
  const delta = D(input.quantityDelta);
  if (delta.eq(0)) {
    throw new InventoryError('Stock quantity change cannot be zero.');
  }

  const product = await tx.product.findUnique({
    where: { id: input.productId },
  });
  if (!product) {
    throw new InventoryError('Product not found.');
  }

  const warehouse = await tx.warehouse.findUnique({
    where: { id: input.warehouseId },
  });
  if (!warehouse) {
    throw new InventoryError('Warehouse not found.');
  }

  let whStock = await tx.warehouseStock.findUnique({
    where: {
      productId_warehouseId: {
        productId: input.productId,
        warehouseId: input.warehouseId,
      },
    },
  });

  const beforeWhQty = whStock ? D(whStock.quantity) : D(0);
  const afterWhQty = beforeWhQty.plus(delta);

  // Check negative stock rule
  if (afterWhQty.lt(0)) {
    let allowNeg = input.allowNegativeStock ?? false;
    if (!allowNeg) {
      const settings = await tx.companySettings.findFirst();
      allowNeg = settings?.allowNegativeStock ?? false;
    }
    if (!allowNeg) {
      throw new InventoryError(
        `Insufficient stock for '${product.nameEn}' (SKU: ${product.sku}) in '${
          warehouse.nameEn
        }'. Available: ${beforeWhQty.toNumber()}, Requested deduction: ${delta
          .abs()
          .toNumber()}.`
      );
    }
  }

  if (whStock) {
    whStock = await tx.warehouseStock.update({
      where: { id: whStock.id },
      data: { quantity: afterWhQty.toNumber() },
    });
  } else {
    whStock = await tx.warehouseStock.create({
      data: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: afterWhQty.toNumber(),
      },
    });
  }

  const newTotalStock = D(product.totalStock).plus(delta);
  const unitCost =
    input.unitCostUsd !== undefined ? roundUsd(input.unitCostUsd) : roundUsd(product.purchaseCostUsd);

  await tx.product.update({
    where: { id: product.id },
    data: {
      totalStock: newTotalStock.toNumber(),
    },
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      productId: product.id,
      warehouseId: warehouse.id,
      type: input.type,
      quantity: delta.toNumber(),
      beforeQty: beforeWhQty.toNumber(),
      afterQty: afterWhQty.toNumber(),
      unitCostUsd: unitCost.toNumber(),
      referenceType: input.referenceType || input.type,
      referenceId: input.referenceId || null,
      reason: input.reason || null,
      createdById: input.createdById || null,
    },
  });

  // If this is a manual stock adjustment or opening stock, post corresponding Journal Entry
  if (
    input.postJournalForAdjustment &&
    (input.type === 'ADJUSTMENT_IN' ||
      input.type === 'ADJUSTMENT_OUT' ||
      input.type === 'OPENING_STOCK')
  ) {
    const adjustmentValueUsd = roundUsd(delta.abs().mul(unitCost));
    if (adjustmentValueUsd.gt(0)) {
      if (input.type === 'OPENING_STOCK') {
        await postJournalEntryInTx(tx, {
          description: `Opening stock for ${product.nameEn} (${delta.toNumber()} ${product.unit})`,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: movement.id,
          isDemo: input.isDemo ?? product.isDemo,
          createdById: input.createdById || null,
          lines: [
            {
              accountCode: '1300', // Inventory Asset
              debitUsd: adjustmentValueUsd,
              creditUsd: 0,
            },
            {
              accountCode: '3000', // Owner's Equity
              debitUsd: 0,
              creditUsd: adjustmentValueUsd,
            },
          ],
        });
      } else if (delta.gt(0)) {
        // Surplus found -> Increase Inventory (Debit 1300), Decrease Shrinkage/Adjustment Expense (Credit 5200)
        await postJournalEntryInTx(tx, {
          description: `Stock adjustment surplus: ${product.nameEn} (+${delta.toNumber()} ${
            product.unit
          }) — ${input.reason || 'Inventory Count'}`,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: movement.id,
          isDemo: input.isDemo ?? product.isDemo,
          createdById: input.createdById || null,
          lines: [
            {
              accountCode: '1300',
              debitUsd: adjustmentValueUsd,
              creditUsd: 0,
            },
            {
              accountCode: '5200',
              debitUsd: 0,
              creditUsd: adjustmentValueUsd,
            },
          ],
        });
      } else {
        // Shortage / Damaged -> Increase Shrinkage Expense (Debit 5200), Decrease Inventory (Credit 1300)
        await postJournalEntryInTx(tx, {
          description: `Stock adjustment reduction: ${product.nameEn} (${delta.toNumber()} ${
            product.unit
          }) — ${input.reason || 'Damaged / Shrinkage'}`,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: movement.id,
          isDemo: input.isDemo ?? product.isDemo,
          createdById: input.createdById || null,
          lines: [
            {
              accountCode: '5200',
              debitUsd: adjustmentValueUsd,
              creditUsd: 0,
            },
            {
              accountCode: '1300',
              debitUsd: 0,
              creditUsd: adjustmentValueUsd,
            },
          ],
        });
      }
    }
  }

  return {
    movement,
    warehouseQuantity: afterWhQty.toNumber(),
    totalStock: newTotalStock.toNumber(),
  };
}

/**
 * Standalone manual stock adjustment service.
 */
export async function adjustProductStock(params: {
  productId: string;
  warehouseId: string;
  quantityDelta: DecimalValue;
  reason: string;
  allowNegativeStock?: boolean;
  userId?: string | null;
}) {
  const delta = D(params.quantityDelta);
  return prisma.$transaction(async (tx) => {
    return applyStockChangeInTx(tx, {
      productId: params.productId,
      warehouseId: params.warehouseId,
      quantityDelta: delta,
      type: delta.gt(0) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      reason: params.reason,
      allowNegativeStock: params.allowNegativeStock,
      postJournalForAdjustment: true,
      createdById: params.userId || null,
    });
  });
}

/**
 * Transfers stock atomically between two warehouses.
 */
export async function transferWarehouseStock(params: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: DecimalValue;
  notes?: string;
  userId?: string | null;
}) {
  if (params.fromWarehouseId === params.toWarehouseId) {
    throw new InventoryError('Source and destination warehouses must be different.');
  }
  const qty = D(params.quantity);
  if (qty.lte(0)) {
    throw new InventoryError('Transfer quantity must be greater than zero.');
  }

  return prisma.$transaction(async (tx) => {
    const count = await tx.stockTransfer.count();
    const transferNumber = `TRF-${new Date().getFullYear()}-${String(count + 1).padStart(
      4,
      '0'
    )}`;

    const transfer = await tx.stockTransfer.create({
      data: {
        transferNumber,
        fromWarehouseId: params.fromWarehouseId,
        toWarehouseId: params.toWarehouseId,
        productId: params.productId,
        quantity: qty.toNumber(),
        notes: params.notes || null,
        status: 'COMPLETED',
        createdById: params.userId || null,
      },
      include: {
        product: true,
        fromWarehouse: true,
        toWarehouse: true,
      },
    });

    await applyStockChangeInTx(tx, {
      productId: params.productId,
      warehouseId: params.fromWarehouseId,
      quantityDelta: qty.neg(),
      type: 'TRANSFER_OUT',
      referenceType: 'STOCK_TRANSFER',
      referenceId: transfer.id,
      reason: `Transfer to ${transfer.toWarehouse.nameEn} (${transferNumber})`,
      allowNegativeStock: false,
      postJournalForAdjustment: false,
      createdById: params.userId || null,
    });

    await applyStockChangeInTx(tx, {
      productId: params.productId,
      warehouseId: params.toWarehouseId,
      quantityDelta: qty,
      type: 'TRANSFER_IN',
      referenceType: 'STOCK_TRANSFER',
      referenceId: transfer.id,
      reason: `Transfer from ${transfer.fromWarehouse.nameEn} (${transferNumber})`,
      allowNegativeStock: false,
      postJournalForAdjustment: false,
      createdById: params.userId || null,
    });

    return transfer;
  });
}

/**
 * Computes complete Inventory Valuation & Low-Stock summary.
 */
export async function getInventoryValuation(params?: {
  warehouseId?: string;
  categoryId?: string;
}) {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(params?.categoryId ? { categoryId: params.categoryId } : {}),
    },
    include: {
      category: true,
      warehouseStocks: {
        include: { warehouse: true },
      },
    },
    orderBy: { nameEn: 'asc' },
  });

  let totalCostValueUsd = D(0);
  let totalRetailValueUsd = D(0);
  let totalUnits = D(0);
  let lowStockCount = 0;
  let outOfStockCount = 0;

  const items = products.map((p) => {
    const qty = params?.warehouseId
      ? D(
          p.warehouseStocks.find((ws) => ws.warehouseId === params.warehouseId)
            ?.quantity || 0
        )
      : D(p.totalStock);

    const cost = D(p.purchaseCostUsd);
    const price = D(p.sellingPriceUsd);
    const minLevel = D(p.minStockLevel);

    const costValue = roundUsd(qty.mul(cost));
    const retailValue = roundUsd(qty.mul(price));
    const potentialProfit = roundUsd(retailValue.minus(costValue));

    const isOutOfStock = qty.lte(0);
    const isLowStock = !isOutOfStock && qty.lte(minLevel);

    if (isOutOfStock) outOfStockCount++;
    if (isLowStock) lowStockCount++;

    totalUnits = totalUnits.plus(qty);
    totalCostValueUsd = totalCostValueUsd.plus(costValue);
    totalRetailValueUsd = totalRetailValueUsd.plus(retailValue);

    return {
      productId: p.id,
      sku: p.sku,
      barcode: p.barcode,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      nameKu: p.nameKu,
      categoryNameEn: p.category.nameEn,
      categoryNameAr: p.category.nameAr,
      categoryNameKu: p.category.nameKu,
      unit: p.unit,
      quantity: qty.toNumber(),
      minStockLevel: minLevel.toNumber(),
      purchaseCostUsd: roundUsd(cost).toNumber(),
      sellingPriceUsd: roundUsd(price).toNumber(),
      costValueUsd: costValue.toNumber(),
      retailValueUsd: retailValue.toNumber(),
      potentialProfitUsd: potentialProfit.toNumber(),
      isLowStock,
      isOutOfStock,
      warehouseBreakdown: p.warehouseStocks.map((ws) => ({
        warehouseId: ws.warehouseId,
        warehouseNameEn: ws.warehouse.nameEn,
        warehouseNameAr: ws.warehouse.nameAr,
        warehouseNameKu: ws.warehouse.nameKu,
        quantity: D(ws.quantity).toNumber(),
      })),
    };
  });

  return {
    items,
    totalProducts: items.length,
    totalUnits: totalUnits.toNumber(),
    totalCostValueUsd: roundUsd(totalCostValueUsd).toNumber(),
    totalRetailValueUsd: roundUsd(totalRetailValueUsd).toNumber(),
    totalPotentialProfitUsd: roundUsd(
      totalRetailValueUsd.minus(totalCostValueUsd)
    ).toNumber(),
    lowStockCount,
    outOfStockCount,
  };
}

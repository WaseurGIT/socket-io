import { timeStamp } from "console";
import { create } from "domain";
import { stat } from "fs";

export function validateOrder(data) {
  if (!data.customerName?.trim()) {
    return {
      valid: false,
      message: "Customer name is required",
    };
  }

  if (!data.customerPhone?.trim()) {
    return {
      valid: false,
      message: "Customer phone is required",
    };
  }

  if (!data.customerAddress?.trim()) {
    return {
      valid: false,
      message: "Customer address is required",
    };
  }

  if (!Array.isArray(data.items)) {
    return {
      valid: false,
      message: "Order must have at least one item",
    };
  }

  return {
    valid: true,
    message: "Order is valid",
  };
}

// order id generator: fomat: ORD-20260318-001
export function generateOrderId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  return `ORD-${year}${month}${day}-${random}`;
}

export function calculateTotals(items) {
  const subTotal = items.reduce((sum, item) => {
    sum + item.price * item.quantity;
  }, 0);

  const tax = subTotal * 0.1;
  const deliveryFee = 35.0;
  const total = subTotal + tax + deliveryFee;
  return {
    subTotal: Math.round(subTotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    deliveryFee,
    totalAmount: Math.round(total * 100) / 100,
  };
}

//
export function createOrderDocument(orderData, orderId, totals) {
  return {
    orderId,
    customerName: orderData.customerName.trim(),
    customerPhone: orderData.customerPhone.trim(),
    customerAddress: orderData.customerAddress.trim(),
    items: orderData.items,
    subTotal: totals.subTotal,
    tax: totals.tax,
    deliveryFee: totals.deliveryFee,
    totalAmount: totals.totalAmount,
    specialNotes: orderData.specialNotes?.trim() || "",
    paymentMethod: orderData.paymentMethod || "",
    paymentStatus: "pending",
    status: "pending",
    statusHistory: [
      {
        status: "pending",
        timeStamp: new Date(),
        by: "Customer",
        note: "Order Placed",
      },
    ],
    estimatedTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

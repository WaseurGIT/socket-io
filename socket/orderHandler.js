import { getCollection } from "../config/database.js";
import {
  calculateTotals,
  createOrderDocument,
  generateOrderId,
  isValidStatusTransition,
} from "../utils/helper.js";

export const orderHandler = (io, socket) => {
  console.log("a user connected: " + socket.id);

  // place order
  socket.on("placeOrder", async (data, callback) => {
    try {
      console.log(`Placed order from : ${socket.id}`);
      const validation = validateOrder(data);
      if (!validation.valid) {
        return callback({ success: false, message: validation.message });
      }

      const totals = calculateTotals(data.items);
      const orderId = generateOrderId();
      const order = createOrderDocument(data, orderId, totals);

      const ordersCollection = getCollection("orders");
      await ordersCollection.insertOne(order);

      socket.join(`order-${orderId}`);
      socket.join("customers");

      io.to("admins").emit("newOrder", order);

      callback({ success: true, order });
      console.log(`Order ${orderId} created successfully`);
    } catch (error) {
      console.error(error);
      callback({ success: false, message: "Failed to place order" });
    }
  });

  //   track order
  socket.on("trackOrder", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");

      const order = await ordersCollection.findOne({ orderId: data.orderId });
      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }

      socket.join(`order-${data.orderId}`);
      callback({ success: true, order });
    } catch (error) {
      console.error("Order tracking error:", error);
      callback({ success: false, message: "Failed to track order" });
    }
  });

  //   cancel order
  socket.on("cancelOrder", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });
      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }

      if (!["pending", "confirmed"].includes(order.status)) {
        return callback({
          success: false,
          message: "Order cannot be cancelled at this stage",
        });
      }

      await ordersCollection.updateOne(
        { orderId: data.orderId },
        {
          $set: { status: "cancelled", updatedAt: new Date() },
          $push: {
            statusHistory: { status: "cancelled" },
            timestamp: new Date(),
            by: socket.id,
            note: data.reason || "Cancelled By Customer",
          },
        },
        io
          .to(`order-${data.orderId}`)
          .emit("orderCancelled", { orderId: data.orderId }),
      );
      io.to("admins").emit("orderCancelled", {
        orderId: data.orderId,
        customerName: order.customerName,
      });

      callback({ success: true, message: "Order cancelled successfully" });
    } catch (error) {
      console.error("Order cancellation error:", error);
      callback({ success: false, message: "Failed to cancel order" });
    }
  });

  //   get all orders for admin dashboard
  socket.on("getMyOrders", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const orders = await ordersCollection
        .find({
          customerPhone: data.customerPhone,
        })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();

      callback({ success: true, orders });
    } catch (error) {
      console.error("Get My Orders error:", error);
      callback({ success: false, message: "Failed to get orders" });
    }
  });

  //   admin
  //   admin login
  socket.on("adminLogin", async (data, callback) => {
    try {
      if (data.password === process.env.ADMIN_PASSWORD) {
        socket.isAdmin = true;
        socket.join("admins");
        console.log(`Admin logged in: ${socket.id}`);
        callback({ success: true, message: "Admin login successful" });
      } else {
        callback({ success: false, message: "Invalid admin password" });
      }
    } catch (error) {
      console.error("Admin login error:", error);
      callback({ success: false, message: "Failed to login" });
    }
  });

  //   get all orders for admin dashboard
  socket.on("getAllOrders", async (data, callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }

      const ordersCollection = getCollection("orders");
      const filters = data?.status ? { status: data.status } : {};
      const orders = await ordersCollection
        .find(filters)
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

      callback({ success: true, orders });
    } catch (error) {
      console.error("Get All Orders error:", error);
      callback({ success: false, message: "Failed to get orders" });
    }
  });

  socket.on("updateOrderStatus", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });

      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }

      if (!isValidStatusTransition(order.status, data.newStatus)) {
        return callback({
          success: false,
          message: `Invalid status transition from ${order.status} to ${data.newStatus}`,
        });
      }

      const result = await ordersCollection.finOneAndUpdate(
        {
          orderId: data.orderId,
        },
        {
          $set: { status: data.newStatus, updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: data.newStatus,
              timestamp: new Date(),
              by: socket.id,
              note: data.note || `Status changed to ${data.newStatus} by admin`,
            },
          },
        },
        {
          returnDocument: "after",
        },
      );

      io.to(`order-${data.orderId}`).emit("orderStatusUpdated", {
        orderId: data.orderId,
        newStatus: data.newStatus,
        order: result,
      });

      socket.to("admins").emit("orderStatusChanged", {
        orderId: data.orderId,
        newStatus: data.newStatus,
        customerName: order.customerName,
      });
      callback({ success: true, message: "Order status updated successfully" });
    } catch (error) {
      console.error("Update Order Status error:", error);
      callback({ success: false, message: "Failed to update order status" });
    }
  });

  // accept order
  socket.on("acceptOrder", async (data, callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }

      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });

      if (!order || order.status !== "pending") {
        return callback({
          success: false,
          message: "Order not found or cannot be accepted",
        });
      }

      const estimatedTime = data.estimatedTime || 30;

      const result = await ordersCollection.finOneAndUpdate(
        { orderId: data.orderId },
        {
          $set: { status: "confirmed", estimatedTime, updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: "confirmed",
              timestamp: new Date(),
              by: socket.id,
              note: `Order accepted by admin, estimated time: ${estimatedTime} mins`,
            },
          },
        },
        { returnDocument: "after" },
      );

      io.to(`order-${data.orderId}`).emit("orderAccepted", {
        orderId: data.orderId,
        estimatedTime,
        order: result,
      });

      socket.on("admins").emit("orderAcceptedByAdmin", {
        orderId: data.orderId,
        customerName: order.customerName,
      });

      callback({
        success: true,
        message: "Order accepted successfully",
        order: result,
      });
    } catch (error) {
      console.error("Accept Order error:", error);
      callback({ success: false, message: "Failed to accept order" });
    }
  });

  // reject order
  socket.on("rejectOrder", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });

      const result = await ordersCollection.finOneAndUpdate(
        { orderId: data.orderId },
        {
          $set: { status: "cancelled", updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: "cancelled",
              timestamp: new Date(),
              by: socket.id,
              note: "Order cancelled by admin",
            },
          },
        },
        { returnDocument: "after" },
      );

      io.to(`order-${data.orderId}`).emit("orderRejected", {
        orderId: data.orderId,
        reason: data.reason,
      });

      socket.on("admins").emit("orderRejectedByAdmin", {
        reason: data.reason,
      });

      callback({
        success: true,
      });
    } catch (error) {
      console.error("Cancel Order error:", error);
      callback({ success: false, message: "Failed to cancel order" });
    }
  });

  
  //   live stats
  socket.on("getLiveStats", async (data, callback) => {
    try {
      if (!isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }

      const ordersCollection = getCollection("orders");
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stats = {
        totalToday: await ordersCollection.countDocuments({
          createdAt: { $gte: today },
        }),
        pending: await ordersCollection.countDocuments({ status: "pending" }),
        confirmed: await ordersCollection.countDocuments({
          status: "confirmed",
        }),
        preparing: await ordersCollection.countDocuments({
          status: "preparing",
        }),
        ready: await ordersCollection.countDocuments({ status: "ready" }),
        outForDelivery: await ordersCollection.countDocuments({
          status: "out-for-delivery",
        }),
        delivered: await ordersCollection.countDocuments({
          status: "delivered",
        }),
        cancelled: await ordersCollection.countDocuments({
          status: "cancelled",
        }),
      };

      callback({ success: true, stats });
    } catch (error) {
      console.error("Get Live Stats error:", error);
      callback({ success: false, message: "Failed to get live stats" });
    }
  });
};

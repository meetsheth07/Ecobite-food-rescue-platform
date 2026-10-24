const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodListing",
      required: true,
      unique: true,
    },
    donor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    volunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["claimed", "picked_up", "delivered"],
      default: "claimed",
      index: true,
    },
    meals: { type: Number, required: true, min: 1 },
    co2Kg: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Match", matchSchema);

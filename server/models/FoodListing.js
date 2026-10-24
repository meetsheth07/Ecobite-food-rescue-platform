const mongoose = require("mongoose");

const foodListingSchema = new mongoose.Schema(
  {
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    quantity: { type: Number, required: true, min: 1, max: 100000 },
    unit: { type: String, enum: ["meals", "kg"], required: true },
    foodType: {
      type: String,
      enum: ["cooked", "raw", "packaged"],
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (coordinates) =>
            coordinates.length === 2 &&
            coordinates[0] >= -180 &&
            coordinates[0] <= 180 &&
            coordinates[1] >= -90 &&
            coordinates[1] <= 90,
          message: "Location coordinates must be [longitude, latitude].",
        },
      },
    },
    preparedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    temperatureControlled: { type: Boolean, required: true },
    allergens: {
      type: [String],
      enum: ["Vegan", "Halal", "Jain", "Nut-free"],
      default: [],
    },
    liabilityWaiver: { type: Boolean, required: true, validate: (value) => value },
    status: {
      type: String,
      enum: ["available", "claimed", "completed", "expired"],
      default: "available",
      index: true,
    },
    availableQuantity: { type: Number, required: true, min: 0 },
    matchedReceiverCount: { type: Number, min: 0, default: 0 },
    matchedReceivers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

foodListingSchema.index({ location: "2dsphere" });
foodListingSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("FoodListing", foodListingSchema);

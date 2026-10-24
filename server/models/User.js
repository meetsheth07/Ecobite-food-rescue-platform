const mongoose = require("mongoose");

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], required: true, default: "Point" },
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
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["donor", "receiver", "volunteer", "admin"],
      required: true,
    },
    organization: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 30 },
    location: { type: pointSchema, required: true },
    serviceRadiusKm: { type: Number, min: 1, max: 100, default: 10 },
    capacityMeals: { type: Number, min: 0, default: 0 },
    reservedMeals: { type: Number, min: 0, default: 0 },
    available: { type: Boolean, default: true },
    verified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

userSchema.pre("validate", function setVerificationStatus() {
  if (this.verified) this.verificationStatus = "verified";
});

userSchema.index({ location: "2dsphere" });
userSchema.index({ role: 1, verified: 1, available: 1 });
userSchema.index({ role: 1, verificationStatus: 1 });

module.exports = mongoose.model("User", userSchema);

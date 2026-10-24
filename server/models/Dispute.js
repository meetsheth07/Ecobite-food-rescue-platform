const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    match: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      enum: ["food-safety", "delivery", "quantity", "conduct", "other"],
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolution: { type: String, trim: true, maxlength: 1000, default: "" },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Dispute", disputeSchema);

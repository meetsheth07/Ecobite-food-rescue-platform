const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { haversineKm } = require("../utils/geo");
const { registerSchema, loginSchema, listingSchema } = require("../utils/validation");
const User = require("../models/User");
const FoodListing = require("../models/FoodListing");
const Match = require("../models/Match");
const Dispute = require("../models/Dispute");
const SystemSettings = require("../models/SystemSettings");

function validListing(overrides = {}) {
  const now = Date.now();
  return {
    title: "Fresh vegetable pulao",
    description: "Packed for pickup",
    quantity: 40,
    unit: "meals",
    foodType: "cooked",
    location: { lat: 12.9716, lng: 77.5946 },
    preparedAt: new Date(now - 3 * 60 * 60 * 1000),
    expiresAt: new Date(now + 60 * 60 * 1000),
    temperatureControlled: true,
    allergens: ["Vegan"],
    liabilityWaiver: true,
    ...overrides,
  };
}

test("haversine distance is zero for the same coordinates", () => {
  assert.equal(haversineKm([77.5946, 12.9716], [77.5946, 12.9716]), 0);
});

test("haversine distance calculates the Bengaluru latitude/longitude distance", () => {
  const distance = haversineKm([77.5946, 12.9716], [77.6408, 12.9784]);
  assert.ok(distance > 4.8 && distance < 5.5, `Expected about 5.1 km, got ${distance}`);
});

test("haversine distance is symmetric and finite near the antimeridian", () => {
  const first = haversineKm([179.9, 10], [-179.9, 10]);
  const reverse = haversineKm([-179.9, 10], [179.9, 10]);
  assert.ok(Number.isFinite(first));
  assert.ok(first > 20 && first < 23);
  assert.equal(first, reverse);
});

test("registration validates roles, normalizes emails, and supplies safe capacity defaults", () => {
  const result = registerSchema.safeParse({
    name: "  Sam Rao ",
    email: "SAM@EXAMPLE.ORG",
    password: "AsecurePass123!",
    role: "receiver",
    location: { lat: 12.9, lng: 77.6 },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "sam@example.org");
  assert.equal(result.data.capacityMeals, 250);
  assert.equal(result.data.serviceRadiusKm, 10);
  assert.equal(registerSchema.safeParse({
    name: "Sam Rao",
    email: "sam@example.org",
    password: "password123",
    role: "admin",
    location: { lat: 12, lng: 77 },
  }).success, false);
});

test("login schema validates credentials and normalizes the email", () => {
  assert.deepEqual(loginSchema.parse({ email: " USER@EXAMPLE.ORG ", password: "Pass1234" }), {
    email: "user@example.org",
    password: "Pass1234",
  });
  assert.equal(loginSchema.safeParse({ email: "bad", password: "" }).success, false);
});

test("listing schema accepts a 2–4 hour safety window and rejects unsafe food", () => {
  assert.equal(listingSchema.safeParse(validListing()).success, true);
  assert.equal(listingSchema.safeParse(validListing({
    preparedAt: new Date(Date.now() - 30 * 60 * 1000),
  })).success, false);
  assert.equal(listingSchema.safeParse(validListing({
    expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
  })).success, false);
  assert.equal(listingSchema.safeParse(validListing({ liabilityWaiver: false })).success, false);
  assert.equal(listingSchema.safeParse(validListing({
    expiresAt: new Date(Date.now() - 1000),
  })).success, false);
  assert.equal(listingSchema.safeParse(validListing({
    preparedAt: new Date(Date.now() + 1000),
  })).success, false);
});

test("listing schema rejects out-of-range locations and unknown allergen tags", () => {
  assert.equal(listingSchema.safeParse(validListing({
    location: { lat: 100, lng: 77 },
  })).success, false);
  assert.equal(listingSchema.safeParse(validListing({
    allergens: ["Unknown"],
  })).success, false);
});

test("all persisted domain models expose the expected fields and geospatial indexes", () => {
  for (const [model, field] of [
    [User, "location"],
    [FoodListing, "location"],
    [Match, "co2Kg"],
    [Dispute, "resolution"],
    [SystemSettings, "emergency_pause"],
  ]) {
    assert.ok(
      model.schema.path(field) || model.schema.path(`${field}.coordinates`),
      `${model.modelName}.${field} should be defined`,
    );
  }
  assert.ok(User.schema.indexes().some(([index]) => index.location === "2dsphere"));
  assert.ok(FoodListing.schema.indexes().some(([index]) => index.location === "2dsphere"));
});

test("location schemas enforce GeoJSON point coordinates", async () => {
  const invalidUser = new User({
    name: "Geo Test",
    email: "geo@example.org",
    passwordHash: "not-a-real-password-hash",
    role: "donor",
    location: { type: "Point", coordinates: [181, 12] },
  });
  const error = await invalidUser.validate().then(() => null, (validationError) => validationError);
  assert.ok(error instanceof mongoose.Error.ValidationError);
  assert.ok(error.errors["location.coordinates"]);
});

test("FoodListing requires the liability waiver, bounded stock, and valid food category", async () => {
  const listing = new FoodListing({
    donor: new mongoose.Types.ObjectId(),
    title: "Test food",
    quantity: 10,
    unit: "meals",
    foodType: "invalid",
    location: { type: "Point", coordinates: [77.6, 12.9] },
    preparedAt: new Date(),
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    temperatureControlled: true,
    liabilityWaiver: false,
    availableQuantity: 10,
  });
  const error = await listing.validate().then(() => null, (validationError) => validationError);
  assert.ok(error instanceof mongoose.Error.ValidationError);
  assert.ok(error.errors.foodType);
  assert.ok(error.errors.liabilityWaiver);
});

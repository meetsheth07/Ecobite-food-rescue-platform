process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "ecobite-integration-test-secret-at-least-32-characters";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { app } = require("../server");
const { seed } = require("../seed");
const User = require("../models/User");
const FoodListing = require("../models/FoodListing");
const Match = require("../models/Match");
const Dispute = require("../models/Dispute");
const SystemSettings = require("../models/SystemSettings");

let replicaSet;

function parsePdf(response, callback) {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

test(
  "EcoBite API integration: authentication, RBAC, food rescue, delivery, impact, disputes, and emergency pause",
  { timeout: 240_000 },
  async (t) => {
    try {
      replicaSet = await MongoMemoryReplSet.create({
        binary: { version: "7.0.14" },
        replSet: { count: 1, storageEngine: "wiredTiger" },
      });
      await mongoose.connect(replicaSet.getUri());
      await Promise.all([
        User.init(),
        FoodListing.init(),
        Match.init(),
        Dispute.init(),
        SystemSettings.init(),
      ]);
      await seed({ uri: replicaSet.getUri(), disconnect: false });
    } catch (error) {
      if (replicaSet) await replicaSet.stop();
      throw new Error(
        `Could not start the MongoDB test replica set: ${error.message}. Check MongoDB binary download access or set MONGOMS_SYSTEM_BINARY.`,
        { cause: error },
      );
    }

    t.after(async () => {
      await mongoose.disconnect();
      await replicaSet?.stop();
    });

    await t.test("health and route errors are explicit", async () => {
      const health = await request(app).get("/api/health").expect(200);
      assert.deepEqual(health.body, { status: "ok", database: "connected" });
      const missing = await request(app).get("/api/not-a-route").expect(404);
      assert.match(missing.body.message, /No API route/);
      await request(app).get("/api/auth/me").expect(401);
    });

    await t.test("login cookies, identity lookup, invalid credentials, and logout work", async () => {
      const donor = request.agent(app);
      const badLogin = await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "incorrect-password" })
        .expect(401);
      assert.equal(badLogin.body.message, "Email or password is incorrect.");

      const login = await donor
        .post("/api/auth/login")
        .send({ email: "DONOR1@ECOBITE.ORG", password: "EcoBite123!" })
        .expect(200);
      assert.equal(login.body.user.role, "donor");
      assert.match(login.headers["set-cookie"][0], /HttpOnly/i);
      assert.equal(login.headers["set-cookie"][0].includes("passwordHash"), false);
      const identity = await donor.get("/api/auth/me").expect(200);
      assert.equal(identity.body.user.email, "donor1@ecobite.org");
      assert.equal(Object.hasOwn(identity.body.user, "passwordHash"), false);

      await donor.post("/api/auth/logout").expect(204);
      await donor.get("/api/auth/me").expect(401);
    });

    await t.test("registration validates input, blocks admin self-registration, and queues NGO verification", async () => {
      const invalid = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Test Account",
          email: "test@ecobite.org",
          password: "password123",
          role: "donor",
          location: { lat: 120, lng: 77 },
        })
        .expect(400);
      assert.ok(Array.isArray(invalid.body.errors));

      await request(app)
        .post("/api/auth/register")
        .send({
          name: "Admin Attempt",
          email: "attempt@ecobite.org",
          password: "password123",
          role: "admin",
          location: { lat: 12, lng: 77 },
        })
        .expect(400);

      const pending = request.agent(app);
      const registration = await pending
        .post("/api/auth/register")
        .send({
          name: "New Partner",
          organization: "Fresh Start Shelter",
          email: "pending@ecobite.org",
          password: "securePass123!",
          role: "receiver",
          phone: "+919000000001",
          location: { lat: 12.9784, lng: 77.6408 },
          capacityMeals: 300,
          serviceRadiusKm: 10,
        })
        .expect(201);
      assert.equal(registration.body.user.verified, false);
      assert.equal(registration.body.user.verificationStatus, "pending");
      await pending.get("/api/listings/nearby").expect(403);

      const duplicate = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Duplicate User",
          email: "donor1@ecobite.org",
          password: "securePass123!",
          role: "donor",
          location: { lat: 12.9784, lng: 77.6408 },
        })
        .expect(409);
      assert.match(duplicate.body.message, /already exists/i);
    });

    await t.test("RBAC, admin verification, and receiver capacity defaults behave correctly", async () => {
      const donor = request.agent(app);
      const receiver = request.agent(app);
      const admin = request.agent(app);

      await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await receiver
        .post("/api/auth/login")
        .send({ email: "ngo1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await admin
        .post("/api/auth/login")
        .send({ email: "admin@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      await receiver.get("/api/listings/mine").expect(403);
      await donor.get("/api/admin/overview").expect(403);
      const overview = await admin.get("/api/admin/overview").expect(200);
      assert.equal(overview.body.donors, 5);
      assert.equal(overview.body.volunteers, 3);
      assert.equal(overview.body.pendingReceivers.length, 1);
      const pendingId = overview.body.pendingReceivers[0]._id;
      const rejected = await admin
        .patch(`/api/admin/users/${pendingId}/verify`)
        .send({ verified: false })
        .expect(200);
      assert.equal(rejected.body.user.verificationStatus, "rejected");
      const approved = await admin
        .patch(`/api/admin/users/${pendingId}/verify`)
        .send({ verified: true })
        .expect(200);
      assert.equal(approved.body.user.verified, true);
      assert.equal(approved.body.user.verificationStatus, "verified");
      const duplicateApproval = await admin
        .patch(`/api/admin/users/${pendingId}/verify`)
        .send({ verified: true })
        .expect(200);
      assert.equal(duplicateApproval.body.user.role, "receiver");
      await admin.patch(`/api/admin/users/not-an-id/verify`).send({ verified: true }).expect(400);
      const verifiedReceiver = await User.findById(pendingId);
      assert.equal(verifiedReceiver.capacityMeals, 300);
      assert.equal(verifiedReceiver.reservedMeals, 0);
    });

    await t.test("donors publish safe food and receivers see nearby capacity-matched listings", async () => {
      const donor = request.agent(app);
      const receiver = request.agent(app);
      await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await receiver
        .post("/api/auth/login")
        .send({ email: "ngo1@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      const now = Date.now();
      const unsafe = await donor
        .post("/api/listings")
        .send({
          title: "Unsafe example",
          quantity: 40,
          unit: "meals",
          foodType: "cooked",
          location: { lat: 12.9784, lng: 77.6408 },
          preparedAt: new Date(now - 60 * 60 * 1000),
          expiresAt: new Date(now + 60 * 60 * 1000),
          temperatureControlled: true,
          allergens: [],
          liabilityWaiver: false,
        })
        .expect(400);
      assert.ok(unsafe.body.errors.some((issue) => issue.field === "liabilityWaiver"));

      const listing = await donor
        .post("/api/listings")
        .send({
          title: "Integration test meal boxes",
          description: "Fresh food, packed safely.",
          quantity: 60,
          unit: "meals",
          foodType: "cooked",
          location: { lat: 12.9784, lng: 77.6408 },
          preparedAt: new Date(now - 3 * 60 * 60 * 1000),
          expiresAt: new Date(now + 60 * 60 * 1000),
          temperatureControlled: true,
          allergens: ["Vegan"],
          liabilityWaiver: true,
        })
        .expect(201);
      assert.equal(listing.body.listing.status, "available");
      assert.ok(listing.body.nearbyReceivers.length > 0);
      assert.ok(
        listing.body.nearbyReceivers.every((match) => match.distanceKm <= 10),
      );

      const feed = await receiver.get("/api/listings/nearby").expect(200);
      const found = feed.body.listings.find(
        (entry) => entry._id === listing.body.listing._id,
      );
      assert.ok(found);
      assert.equal(found.mealEstimate, 60);
      assert.equal(found.donor.organization, "Green Fork Bistro");
      assert.ok(found.distanceKm <= 10);
      await donor.get("/api/listings/mine").expect(200);

      globalThis.ecobiteTestListingId = listing.body.listing._id;
      globalThis.ecobiteTestMeals = 60;
    });

    await t.test("concurrent claims create exactly one match and reserve NGO capacity", async () => {
      const receiver = request.agent(app);
      await receiver
        .post("/api/auth/login")
        .send({ email: "ngo1@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      const attempts = await Promise.all([
        receiver
          .post("/api/matches/claim")
          .send({ listingId: globalThis.ecobiteTestListingId }),
        receiver
          .post("/api/matches/claim")
          .send({ listingId: globalThis.ecobiteTestListingId }),
      ]);
      assert.deepEqual(
        attempts.map((response) => response.status).sort(),
        [201, 409],
      );
      const successfulClaim = attempts.find((response) => response.status === 201);
      globalThis.ecobiteTestMatchId = successfulClaim.body.match._id;
      assert.equal(successfulClaim.body.match.meals, 60);
      assert.equal(await Match.countDocuments({ listing: globalThis.ecobiteTestListingId }), 1);
      assert.equal(await User.findById(successfulClaim.body.match.receiver).then((user) => user.reservedMeals), 60);
      assert.equal(
        await FoodListing.findById(globalThis.ecobiteTestListingId).then((entry) => entry.status),
        "claimed",
      );
      const feed = await receiver.get("/api/listings/nearby").expect(200);
      assert.equal(feed.body.listings.some((entry) => entry._id === globalThis.ecobiteTestListingId), false);
      await receiver.get("/api/matches/mine").expect(200);
      await request(receiver)
        .post("/api/matches/claim")
        .send({ listingId: "not-a-valid-id" })
        .expect(400);
    });

    await t.test("volunteers assign routes and delivery updates release reserved capacity once", async () => {
      const volunteer = request.agent(app);
      const secondVolunteer = request.agent(app);
      await volunteer
        .post("/api/auth/login")
        .send({ email: "volunteer1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await secondVolunteer
        .post("/api/auth/login")
        .send({ email: "volunteer2@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      await volunteer.get("/api/volunteer/available").expect(200);
      const assignment = await volunteer
        .post(`/api/volunteer/${globalThis.ecobiteTestMatchId}/assign`)
        .send({})
        .expect(200);
      assert.equal(assignment.body.match.volunteer.name, "Ishan Patel");
      await secondVolunteer
        .post(`/api/volunteer/${globalThis.ecobiteTestMatchId}/assign`)
        .send({})
        .expect(409);

      const pickedUp = await volunteer
        .patch(`/api/matches/${globalThis.ecobiteTestMatchId}/status`)
        .send({ status: "picked_up" })
        .expect(200);
      assert.equal(pickedUp.body.match.status, "picked_up");
      const delivered = await volunteer
        .patch(`/api/matches/${globalThis.ecobiteTestMatchId}/status`)
        .send({ status: "delivered" })
        .expect(200);
      assert.equal(delivered.body.match.status, "delivered");
      const receiver = await User.findById(delivered.body.match.receiver);
      assert.equal(receiver.reservedMeals, 0);
      await volunteer
        .patch(`/api/matches/${globalThis.ecobiteTestMatchId}/status`)
        .send({ status: "delivered" })
        .expect(409);
      await volunteer.get("/api/matches/mine").expect(200);
      await volunteer
        .patch(`/api/matches/${globalThis.ecobiteTestMatchId}/status`)
        .send({ status: "not-a-status" })
        .expect(400);
    });

    await t.test("impact calculations count delivered meals only and CSR reports are valid PDFs", async () => {
      const donor = request.agent(app);
      await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      const impact = await donor.get("/api/impact").expect(200);
      assert.equal(impact.body.mealsSaved, globalThis.ecobiteTestMeals);
      assert.equal(impact.body.co2Kg, 150);
      assert.ok(impact.body.activeDonations >= 10);
      assert.ok(impact.body.activeMatches >= 0);
      const report = await donor
        .get("/api/impact/report")
        .buffer(true)
        .parse(parsePdf)
        .expect(200);
      assert.match(report.headers["content-type"], /application\/pdf/);
      assert.equal(report.body.subarray(0, 4).toString(), "%PDF");
      const otherDonor = request.agent(app);
      await otherDonor
        .post("/api/auth/login")
        .send({ email: "donor2@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      const otherImpact = await otherDonor.get("/api/impact").expect(200);
      assert.equal(otherImpact.body.mealsSaved, 0);
    });

    await t.test("route disputes are participant-scoped and admins can resolve them", async () => {
      const donor = request.agent(app);
      const admin = request.agent(app);
      const otherDonor = request.agent(app);
      await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await admin
        .post("/api/auth/login")
        .send({ email: "admin@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await otherDonor
        .post("/api/auth/login")
        .send({ email: "donor2@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      await otherDonor
        .post("/api/disputes")
        .send({
          matchId: globalThis.ecobiteTestMatchId,
          reason: "delivery",
          description: "This account is not a participant in this route.",
        })
        .expect(404);
      const opened = await donor
        .post("/api/disputes")
        .send({
          matchId: globalThis.ecobiteTestMatchId,
          reason: "food-safety",
          description: "Please review the temperature handling at pickup.",
        })
        .expect(201);
      assert.equal(opened.body.dispute.status, "open");
      const disputeId = opened.body.dispute._id;
      await donor.get("/api/admin/disputes").expect(403);
      const disputeList = await admin.get("/api/admin/disputes").expect(200);
      assert.equal(disputeList.body.disputes.length, 1);
      const resolved = await admin
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .send({ resolution: "Reviewed and documented the partner follow-up." })
        .expect(200);
      assert.equal(resolved.body.dispute.status, "resolved");
      await admin
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .send({ resolution: "This report is already resolved." })
        .expect(404);
    });

    await t.test("emergency pause blocks listings and claims and can be lifted by admins", async () => {
      const donor = request.agent(app);
      const receiver = request.agent(app);
      const admin = request.agent(app);
      await donor
        .post("/api/auth/login")
        .send({ email: "donor1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await receiver
        .post("/api/auth/login")
        .send({ email: "ngo1@ecobite.org", password: "EcoBite123!" })
        .expect(200);
      await admin
        .post("/api/auth/login")
        .send({ email: "admin@ecobite.org", password: "EcoBite123!" })
        .expect(200);

      const paused = await admin
        .patch("/api/admin/system")
        .send({ emergencyPause: true })
        .expect(200);
      assert.equal(paused.body.emergencyPause, true);
      assert.equal((await request(app).get("/api/system").expect(200)).body.emergencyPause, true);

      await donor.post("/api/listings").send({}).expect(503);
      await receiver
        .post("/api/matches/claim")
        .send({ listingId: "aaaaaaaaaaaaaaaaaaaaaaaa" })
        .expect(503);
      await admin.get("/api/admin/overview").expect(200).then(({ body }) => {
        assert.equal(body.emergencyPause, true);
        assert.equal(body.openDisputes, 0);
      });
      await admin
        .patch("/api/admin/system")
        .send({ emergencyPause: false })
        .expect(200);
      assert.equal((await request(app).get("/api/system").expect(200)).body.emergencyPause, false);
      await admin.patch("/api/admin/system").send({ emergencyPause: "false" }).expect(400);
      await admin.patch("/api/admin/system").send({ emergencyPause: true }).expect(200);
      await request(app).post("/api/auth/logout").expect(204);
    });
  },
);

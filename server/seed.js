require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const FoodListing = require("./models/FoodListing");
const Match = require("./models/Match");
const SystemSettings = require("./models/SystemSettings");

const demoPassword = "EcoBite123!";
const places = [
  { name: "Indiranagar", coordinates: [77.6408, 12.9784] },
  { name: "Koramangala", coordinates: [77.6245, 12.9352] },
  { name: "MG Road", coordinates: [77.6067, 12.9747] },
  { name: "Jayanagar", coordinates: [77.5838, 12.925] },
  { name: "Ulsoor", coordinates: [77.6197, 12.9816] },
  { name: "HSR Layout", coordinates: [77.6476, 12.9116] },
  { name: "Richmond Town", coordinates: [77.6023, 12.9648] },
  { name: "Basavanagudi", coordinates: [77.5685, 12.9416] },
  { name: "Domlur", coordinates: [77.6387, 12.9609] },
  { name: "Shivajinagar", coordinates: [77.6041, 12.9857] },
];

async function seed({ uri = process.env.MONGODB_URI, disconnect = true } = {}) {
  if (!uri) throw new Error("MONGODB_URI is required.");
  const shouldConnect = mongoose.connection.readyState === 0;
  if (shouldConnect) await mongoose.connect(uri);
  try {
  await mongoose.connection.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    FoodListing.syncIndexes(),
    Match.syncIndexes(),
    SystemSettings.syncIndexes(),
  ]);

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const donors = await User.create(
    places.slice(0, 5).map((place, index) => ({
      name: `${["Maya", "Arjun", "Neha", "Kabir", "Ananya"][index]} Sharma`,
      email: `donor${index + 1}@ecobite.org`,
      passwordHash,
      role: "donor",
      organization: [
        "Green Fork Bistro",
        "The Daily Table",
        "Cedar House Hotel",
        "Curry Leaf Kitchen",
        "Harvest & Hearth",
      ][index],
      phone: `+91987654010${index}`,
      location: { type: "Point", coordinates: place.coordinates },
      verified: true,
    })),
  );
  const receivers = await User.create(
    places.slice(5).map((place, index) => ({
      name: `${["Asha", "Ravi", "Priya", "Dev", "Meera"][index]} Rao`,
      email: `ngo${index + 1}@ecobite.org`,
      passwordHash,
      role: "receiver",
      organization: [
        "Sunrise Community Kitchen",
        "Hope Shelter Bengaluru",
        "Annapoorna Care Centre",
        "Open Arms Foundation",
        "Neighbourhood Food Bank",
      ][index],
      phone: `+91987654100${index}`,
      location: { type: "Point", coordinates: place.coordinates },
      capacityMeals: 1200,
      serviceRadiusKm: 10,
      available: true,
      verified: true,
    })),
  );
  await User.create(
    places.slice(0, 3).map((place, index) => ({
      name: `${["Ishan", "Tara", "Vikram"][index]} Patel`,
      email: `volunteer${index + 1}@ecobite.org`,
      passwordHash,
      role: "volunteer",
      organization: "EcoBite Volunteer Network",
      phone: `+91987654200${index}`,
      location: { type: "Point", coordinates: place.coordinates },
      available: true,
      verified: true,
    })),
  );
  await User.create({
    name: "EcoBite Administrator",
    email: "admin@ecobite.org",
    passwordHash,
    role: "admin",
    organization: "EcoBite",
    location: { type: "Point", coordinates: [77.5946, 12.9716] },
    verified: true,
  });

  await FoodListing.syncIndexes();
  const titles = [
    "Fresh vegetable pulao",
    "Paneer curry meal boxes",
    "Artisan sourdough loaves",
    "Seasonal fruit baskets",
    "Lentil stew and rice",
    "Grilled vegetable wraps",
    "Breakfast idli packs",
    "Mixed salad bowls",
    "Chickpea masala trays",
    "Bakery bread assortment",
  ];
  const types = ["cooked", "cooked", "packaged", "raw", "cooked", "cooked", "cooked", "raw", "cooked", "packaged"];
  const now = Date.now();
  const listings = [];

  for (let index = 0; index < 10; index += 1) {
    const donor = donors[index % donors.length];
    const titleLocation = places[index];
    const location = {
      type: "Point",
      coordinates: [
        titleLocation.coordinates[0] + (index % 2 ? 0.001 : -0.001),
        titleLocation.coordinates[1] + (index % 3 ? 0.001 : -0.001),
      ],
    };
    const capacityMatches = await User.find({
      role: "receiver",
      verified: true,
      capacityMeals: { $gte: 80 + (index % 4) * 20 },
      location: {
        $near: {
          $geometry: location,
          $maxDistance: 10000,
        },
      },
    }).select("_id").limit(5);
    listings.push({
      donor: donor._id,
      title: titles[index],
      description: "Prepared today and packed for safe, quick redistribution.",
      quantity: 80 + (index % 4) * 20,
      unit: "meals",
      foodType: types[index],
      location,
      preparedAt: new Date(now - 3 * 60 * 60 * 1000),
      expiresAt: new Date(now + 60 * 60 * 1000),
      temperatureControlled: index % 3 !== 0,
      allergens: index % 2 === 0 ? ["Vegan"] : ["Nut-free"],
      liabilityWaiver: true,
      status: "available",
      availableQuantity: 80 + (index % 4) * 20,
      matchedReceivers: capacityMatches.map((receiver) => receiver._id),
    });
  }
  await FoodListing.create(listings);
  await SystemSettings.create({ key: "global", emergency_pause: false });

  console.info(
    `Seed complete: ${donors.length} donors, ${receivers.length} verified NGOs, 3 volunteers, 1 admin, 10 active listings.`,
  );
  console.info(`Demo password for all seeded accounts: ${demoPassword}`);
  return { donors, receivers, password: demoPassword };
  } finally {
    if (disconnect && shouldConnect) await mongoose.disconnect();
  }
}

module.exports = { seed, demoPassword };

if (require.main === module) {
  seed()
    .catch((error) => {
      console.error("Database seed failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}

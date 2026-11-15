import { rupees } from "../src/money.ts";

/** A filled Rent Agreement form (Gurugram, ₹25,000/month). Money is in paise. */
export const sampleForm = {
  property: {
    address: "Flat 402, Tower B, Palm Residency, Sector 12, Gurugram, Haryana",
    configuration: "2BHK",
    furnishing: "SEMI_FURNISHED",
    fixtures: [{ item: "Ceiling fan", quantity: 4 }, { item: "Air conditioner (split)", quantity: 2 }, { item: "Geyser", quantity: 2 }],
  },
  terms: {
    startDate: "2026-11-01", termMonths: 11, monthlyRent: rupees(25000), securityDeposit: rupees(50000),
    rentDueDay: 5, maintenanceIncluded: true, lockInMonths: 6, noticePeriodMonths: 1, renewalEscalationPercent: 5,
    executionPlace: "Gurugram",
  },
};

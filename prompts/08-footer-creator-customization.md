# CHHATH RADIO — Footer & Creator Customization Spec

## Overview

The public-facing footer of Chhath Radio surfaces the creator's social presence, a donation mechanism, and a "Made with ❤️ in India" attribution line. All values are centralized in a single config object (`FOOTER_CONFIG`) inside `frontend/components/radio/Footer.tsx` so they can be changed without touching UI logic.

---

## 1. Footer Sections

### 1.1 Social Links

| Field | Config key | Default |
|---|---|---|
| LinkedIn profile URL | `FOOTER_CONFIG.linkedinUrl` | `https://linkedin.com/in/parasverma` |
| Instagram profile URL | `FOOTER_CONFIG.instagramUrl` | `https://instagram.com/parasverma` |

Both links open in a new tab with `rel="noopener noreferrer"`.

### 1.2 Donate / "Buy me a coffee"

A **Donate** button appears between the social links. Clicking it opens a modal whose content is driven by `FOOTER_CONFIG.payment.provider`.

### 1.3 "Made with ❤️ in India" line

```
Made with ❤️ in India by <creatorName>
```

`creatorName` links to `linkedinUrl`. Controlled by `FOOTER_CONFIG.creatorName`.

### 1.4 Admin link

A low-visibility link to `/admin` is always present at the bottom of the footer.

---

## 2. Payment Provider Abstraction

The payment system is designed to be swapped without touching UI code. The active provider is set via:

```ts
FOOTER_CONFIG.payment.provider = "upi" | "razorpay" | "none"
```

### 2.1 Provider: `"upi"` (current default)

Displays a modal with:
- The UPI ID (selectable text for manual copy)
- A `upi://pay?...` deep-link button that opens any installed UPI app (GPay, PhonePe, Paytm, etc.)

Config keys:

```ts
payment: {
  provider: "upi",
  upi: {
    id: "paras@okaxis",       // your UPI VPA
    payeeName: "Paras Verma", // shown in UPI app
    note: "Buy Paras a coffee ☕",
  }
}
```

The deep-link is built by `buildUpiLink(cfg: UpiConfig): string` — a pure, testable helper.

### 2.2 Provider: `"razorpay"` (future)

When `provider` is set to `"razorpay"`, the same `DonateButton` triggers a Razorpay Checkout modal. To activate:

1. Set `provider: "razorpay"` in `FOOTER_CONFIG`.
2. Fill in `payment.razorpay.keyId` (Razorpay Key ID, starts with `rzp_live_` or `rzp_test_`).
3. Add `<script src="https://checkout.razorpay.com/v1/checkout.js" />` to `app/layout.tsx`.
4. Create a `RazorpayModal` component and render it in `Footer.tsx` when `payment.provider === "razorpay"`.

Config keys:

```ts
payment: {
  provider: "razorpay",
  razorpay: {
    keyId: "rzp_live_XXXX",
    amount: 10000,        // paise (₹100)
    currency: "INR",
    name: "Chhath Radio",
    description: "Buy Paras a coffee ☕",
  }
}
```

### 2.3 Provider: `"none"`

Hides the donate button entirely. No modal is rendered.

---

## 3. How to Customize

Edit **only** the `FOOTER_CONFIG` object at the top of `frontend/components/radio/Footer.tsx`:

```ts
export const FOOTER_CONFIG = {
  creatorName: "Your Name",
  linkedinUrl: "https://linkedin.com/in/your-handle",
  instagramUrl: "https://instagram.com/your-handle",
  payment: {
    provider: "upi",   // switch to "razorpay" or "none" as needed
    upi: {
      id: "yourname@upi",
      payeeName: "Your Full Name",
      note: "Support the project",
    },
    razorpay: {
      keyId: "",
      amount: 10000,
      currency: "INR",
      name: "Chhath Radio",
      description: "Support the project",
    },
  },
} as const;
```

No other file needs to change for social links, creator name, or payment provider switches.

---

## 4. Component Architecture

```
Footer (default export)          — orchestrates layout + modal state
├── LinkedInIcon                 — inline SVG
├── InstagramIcon                — inline SVG
├── CoffeeIcon                   — inline SVG
├── DonateButton                 — renders null when provider === "none"
└── UpiDonateModal               — shown when provider === "upi" && showDonate
```

Exported symbols for testing:

| Symbol | Type | Purpose |
|---|---|---|
| `FOOTER_CONFIG` | `const` | Single source of truth for all footer values |
| `buildUpiLink` | `function` | Pure helper; builds `upi://pay?...` URI |
| `UpiConfig` | `interface` | Type for UPI config object |
| `PaymentProvider` | `type` | Union: `"upi" \| "razorpay" \| "none"` |
| `UpiDonateModal` | component | Testable modal sub-component |
| `DonateButton` | component | Testable button sub-component |

---

## 5. Test Coverage

Tests live in `frontend/__tests__/unit/footer.test.tsx` and cover:

- `buildUpiLink()` — URI format, param encoding, special characters
- `FOOTER_CONFIG` — shape validation, allowed provider values
- `<Footer />` — social links, modal open/close, "Made with ❤️" text, admin link
- `<UpiDonateModal />` — UPI ID display, deep-link href, close interactions
- `<DonateButton />` — render + click
- Payment provider abstraction — config shape contract

---

## 6. Adding a New Payment Provider (e.g. Stripe, PayPal)

1. Add a new key to `FOOTER_CONFIG.payment` with the provider's config.
2. Extend the `PaymentProvider` type union in `Footer.tsx`.
3. Create a new `<ProviderModal />` component.
4. Add a conditional render block in `Footer` for the new provider.
5. Add unit tests for the new modal and config shape.

The `DonateButton` and modal-open state are provider-agnostic and require no changes.
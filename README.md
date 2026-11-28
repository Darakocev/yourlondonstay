# yourlondonstay
## Crypto payment (10% off)

The booking box opens a "How would you like to pay?" window: crypto on the left (QR code, wallet address, screenshot upload), card (Stripe) on the right.
Works without any setup. Optional overrides in Netlify → Site configuration → Environment variables, then redeploy:

- `CRYPTO_ADDRESS` – wallet address guests pay to (default: owner's BNB Chain wallet `0x359B8Ef705f59ccdf84906Bb685FE130489f32C1`, set in `netlify/functions/crypto.mjs`)
- `CRYPTO_COIN` – default `USDT` · `CRYPTO_NETWORK` – default `BNB Smart Chain (BEP20)` · `CRYPTO_DISCOUNT` – default `10`
- `CRYPTO_ENABLED=false` hides crypto without removing the address

Each crypto booking emails the owner (FormSubmit) with a private link to the guest's transaction screenshot (stored in Netlify Blobs, store `crypto-proofs`). The calendar is not blocked automatically: check the payment in the wallet, then confirm the dates and block them in Lodgify/Airbnb.

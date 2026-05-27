# Privacy Policy — Stackd

**Last updated: May 27, 2026**

Stackd ("we", "our", or "us") is a Chrome extension that helps students discover and share referral codes and exclusive discounts. This Privacy Policy explains what information we collect, how we use it, and your rights regarding that information.

---

## 1. Information We Collect

### Information you provide via Google Sign-In
When you sign in with Google OAuth, we receive and store the following from your Google profile:

- **Name** — your display name as it appears on your Google account
- **Email address** — used to identify your account
- **Profile photo URL** — displayed in the extension UI

We do not receive or store your Google password. Authentication is handled entirely by Google's OAuth 2.0 system.

### Information you provide directly
- **University** — optionally selected during onboarding to personalize your benefits feed
- **Referral codes** — codes you choose to share with the community (brand, website, discount description, and code string)
- **Search queries** — queries you type into the AI Smart Search, stored locally in your browser only
- **Community perks** — student benefits you voluntarily submit for your university

### Information collected automatically
- **Coin balance and transaction history** — coins earned from sharing codes and spent on gift card redemptions, stored server-side tied to your account
- **Code votes** — whether you marked a referral code as working or not working
- **Domain visits** — the current website domain is checked locally against our code database to show the floating widget; it is not logged or transmitted to our servers

---

## 2. How We Use Your Information

| Data | Purpose |
|---|---|
| Name, email, profile photo | Account creation, authentication, and display in the extension UI |
| University | Personalizing your benefits feed with university-specific perks |
| Referral codes you share | Displaying them to other Stackd users in the extension |
| Coin balance | Tracking rewards earned from sharing codes and enabling gift card redemptions |
| Code votes | Calculating success rates so the community knows which codes are working |
| Community perks | Showing them to other students at your university |

We do **not** use your information for advertising, behavioral tracking, or any purpose beyond operating the Stackd service.

---

## 3. AI Features

Stackd uses the Anthropic Claude API to power two features:

- **AI Smart Search** — when a search returns zero results, your search query is sent to Claude to find relevant referral codes or student discounts. The query is not permanently associated with your identity on Anthropic's systems.
- **Deal DNA** — a brief analysis of a specific referral code (brand name, description, and code) is sent to Claude to generate deal insights.
- **AI Benefits Discovery** — your university name is sent to Claude to discover perks relevant to students at your school.

Anthropic processes these requests under their own [Privacy Policy](https://www.anthropic.com/privacy). We do not send your name, email, or any personally identifiable information to Claude.

---

## 4. Data Storage

- Your account data (name, email, university, coin balance, codes, votes) is stored in our secure database hosted on [Render](https://render.com).
- Your authentication token is stored locally in Chrome's extension storage (`chrome.storage.local`) on your device.
- Recent searches and widget display preferences are stored locally in Chrome's extension storage and never transmitted to our servers.
- We do not use cookies.

---

## 5. Data Sharing

**We do not sell, rent, or share your personal information with third parties for commercial purposes.**

We share data only in the following limited circumstances:

- **With other Stackd users** — referral codes you submit and community perks you share are visible to all users of the extension. Your name and profile photo may be shown alongside codes you share.
- **With service providers** — we use Render for hosting and Anthropic for AI features. Both are bound by their own privacy policies and process only the data necessary to operate the service.
- **If required by law** — we may disclose information if compelled by a valid legal process.

---

## 6. Data Retention

We retain your account data for as long as your account is active. If you delete your account (see Section 7), we permanently delete your profile, codes, votes, and all associated data within 30 days.

Search queries typed into the AI Smart Search are stored only in your local browser storage and are never sent to our servers — they are cleared when you clear your browser data or uninstall the extension.

---

## 7. How to Delete Your Account

To permanently delete your Stackd account and all associated data:

1. Email us at **getstackd@gmail.com** with the subject line **"Delete my account"**
2. Include the email address linked to your Stackd account
3. We will process your request and confirm deletion within **7 business days**

Upon deletion, we will permanently remove:
- Your name, email, and profile information
- Your coin balance and redemption history
- All referral codes you submitted
- Your code votes and community perk submissions
- Your university selection

---

## 8. Children's Privacy

Stackd is intended for college and university students (18 years of age or older). We do not knowingly collect personal information from anyone under the age of 13. If you believe a minor has provided us with personal information, please contact us at getstackd@gmail.com and we will delete it promptly.

---

## 9. Security

We use industry-standard practices to protect your information:

- All data is transmitted over HTTPS
- Authentication tokens are signed with a secret key using industry-standard JWT
- We use OAuth 2.0 for Google Sign-In — we never see or store your Google password
- Access to our database is restricted to our backend service

No method of transmission or storage is 100% secure. If you become aware of a security issue, please contact us immediately at getstackd@gmail.com.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this document. Continued use of Stackd after changes are posted constitutes your acceptance of the updated policy.

---

## 11. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy, please contact us:

**Email:** getstackd@gmail.com

We will respond to all privacy-related inquiries within 5 business days.

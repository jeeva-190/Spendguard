// Category list + a keyword fallback classifier (used when no AI key is set,
// and as a first guess the AI can override).
const CATEGORIES = [
  'Sales Income',
  'Other Income',
  'Advertising',
  'Software & Tools',
  'Contractors',
  'Inventory & Supplies',
  'Shipping',
  'Food & Dining',
  'Travel & Transport',
  'Shopping',
  'Entertainment',
  'Bills & Utilities',
  'Refunds',
  'Transfers',
  'Other',
];

const RULES = [
  ['Advertising', /\b(meta ads|facebook ads|google ads|instagram promo|tiktok ads|linkedin ads|ads?)\b/i],
  ['Software & Tools', /\b(canva|figma|adobe|notion|grammarly|github|shopify|zoom|slack|openai|anthropic|dropbox|google workspace|saas|subscription|pixelpad|framecraft|notely|writewell)\b/i],
  ['Contractors', /\b(freelanc\w*|contractors?|design work|developer|invoice for|consult\w*|fiverr|upwork)\b/i],
  ['Inventory & Supplies', /\b(suppliers?|alibaba|aliexpress|wholesale|inventory|packaging|raw materials?)\b/i],
  ['Shipping', /\b(dhl|fedex|ups|usps|india post|shipping|courier|shiprocket)\b/i],
  ['Food & Dining', /\b(uber eats|doordash|swiggy|zomato|starbucks|cafe|coffee|restaurant|pizza|grubhub|food)\b/i],
  ['Travel & Transport', /\b(uber|lyft|ola|airbnb|booking\.com|airline|flight|hotel|expedia|train|taxi|ride|cab)\b/i],
  ['Entertainment', /\b(netflix|spotify|steam|playstation|xbox|disney|prime video|youtube premium|movie|streaming|video game|games?)\b/i],
  ['Shopping', /\b(amazon|nike|ebay|walmart|target|flipkart|myntra|zara|apple store|online store|purchase|shoes|sneakers|clothes|clothing|apparel|sports|electronics|phone|gadget)\b/i],
  ['Bills & Utilities', /\b(electric|internet|broadband|phone bill|mobile recharge|utility|rent|insurance)\b/i],
  ['Refunds', /\brefund/i],
  ['Transfers', /\b(withdraw|transfer to bank|bank transfer)\b/i],
];

function ruleCategory(txn) {
  const text = `${txn.counterparty || ''} ${txn.note || ''}`;
  if (txn.kind === 'refund') return 'Refunds';
  if (txn.kind === 'withdrawal') return 'Transfers';
  if (txn.direction === 'in') return txn.kind === 'payment' || /sale|order|invoice|payment for/i.test(text) ? 'Sales Income' : 'Other Income';
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return txn.kind === 'payout' ? 'Contractors' : 'Other';
}

module.exports = { CATEGORIES, ruleCategory };

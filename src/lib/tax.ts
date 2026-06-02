// 1099 self-employment tax calculations for crew members

export interface TaxSummary {
  grossIncome: number;
  totalExpenses: number;
  netIncome: number;
  selfEmploymentTax: number;
  federalIncomeTax: number;
  estimatedTotalTax: number;
  effectiveRate: number;
  quarterlyPayment: number;
}

const SE_TAX_RATE = 0.1530; // 15.3% self-employment tax
const SE_DEDUCTION = 0.5;   // deduct half of SE tax from income

// 2024 single filer brackets (simplified)
const TAX_BRACKETS = [
  { cap: 11600,  rate: 0.10 },
  { cap: 47150,  rate: 0.12 },
  { cap: 100525, rate: 0.22 },
  { cap: 191950, rate: 0.24 },
  { cap: 243725, rate: 0.32 },
  { cap: 609350, rate: 0.35 },
  { cap: Infinity, rate: 0.37 },
];

const STANDARD_DEDUCTION = 14600;

export function calculateTax(grossIncome: number, totalExpenses: number): TaxSummary {
  const netIncome = Math.max(0, grossIncome - totalExpenses);
  const selfEmploymentTax = netIncome * SE_TAX_RATE;
  const seDeduction = selfEmploymentTax * SE_DEDUCTION;
  const taxableIncome = Math.max(0, netIncome - seDeduction - STANDARD_DEDUCTION);
  const federalIncomeTax = computeBrackets(taxableIncome);
  const estimatedTotalTax = selfEmploymentTax + federalIncomeTax;
  const effectiveRate = netIncome > 0 ? estimatedTotalTax / netIncome : 0;

  return {
    grossIncome,
    totalExpenses,
    netIncome,
    selfEmploymentTax,
    federalIncomeTax,
    estimatedTotalTax,
    effectiveRate,
    quarterlyPayment: estimatedTotalTax / 4,
  };
}

function computeBrackets(taxableIncome: number): number {
  let tax = 0;
  let prev = 0;
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= prev) break;
    const amount = Math.min(taxableIncome, bracket.cap) - prev;
    tax += amount * bracket.rate;
    prev = bracket.cap;
  }
  return tax;
}

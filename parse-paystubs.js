import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} Earning
 * @property {string} name - Earning type name (e.g., "Salary", "Bonus")
 * @property {number|null} rate - Hourly rate if applicable
 * @property {number|null} payPeriodHours - Hours worked this period
 * @property {number} payPeriodAmount - Amount earned this period
 * @property {number|null} ytdHours - Year-to-date hours
 * @property {number} ytdAmount - Year-to-date amount
 */

/**
 * @typedef {Object} Tax
 * @property {string} name - Tax name (e.g., "Federal Income Tax")
 * @property {number} payPeriodAmount - Amount withheld this period
 * @property {number} ytdAmount - Year-to-date amount
 */

/**
 * @typedef {Object} Deduction
 * @property {string} name - Deduction name (e.g., "401K", "Health Insurance")
 * @property {number} payPeriodEmployeeDeduction - Employee contribution this period
 * @property {number} payPeriodCompanyContribution - Employer contribution this period
 * @property {number} ytdEmployeeDeduction - Year-to-date employee contribution
 * @property {number} ytdCompanyContribution - Year-to-date employer contribution
 */

/**
 * @typedef {Object} Summary
 * @property {number|null} grossPay - Total gross pay
 * @property {number|null} netPay - Total net pay
 * @property {number|null} totalTaxes - Total taxes withheld
 * @property {number|null} totalDeductions - Total deductions
 * @property {Object} categoryFlow - Flow direction for each category
 */

/**
 * @typedef {Object} Paystub
 * @property {string} payPeriod - Pay period date range (e.g., "1/1/2026 - 1/15/2026")
 * @property {Earning[]} earnings - List of earnings
 * @property {Tax[]} taxes - List of taxes withheld
 * @property {Deduction[]} deductions - List of deductions
 * @property {Summary} summary - Summary totals
 */

// Parse currency string to number with validation
function parseCurrency(str) {
  if (!str || str === '-') return null;
  const cleaned = str.replace(/[$,]/g, '');
  const value = parseFloat(cleaned);
  // Validate the result is a reasonable number
  if (isNaN(value) || value < 0) return null;
  // Round to 2 decimal places for currency precision
  return Math.round(value * 100) / 100;
}

// Parse hours string to number with validation
function parseHours(str) {
  if (!str || str === '-') return null;
  const value = parseFloat(str);
  // Validate the result is a reasonable number
  if (isNaN(value) || value < 0) return null;
  return value;
}

// Parse pay period date string safely
// Returns null if the date is invalid or missing
function parsePayPeriodDate(payPeriod, position = 0) {
  if (!payPeriod || typeof payPeriod !== 'string') return null;
  const parts = payPeriod.split(' - ');
  if (parts.length !== 2) return null;
  const date = new Date(parts[position]);
  return isNaN(date.getTime()) ? null : date;
}

// Extract pay period from header
function extractPayPeriod(text) {
  const payPeriodMatch = text.match(/PAY PERIOD:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  return payPeriodMatch ? `${payPeriodMatch[1]} - ${payPeriodMatch[2]}` : null;
}

// Extract earnings section
function extractEarnings(text) {
  const earnings = [];
  const earningsSection = text.match(/EARNINGS([\s\S]*?)EMPLOYEE TAXES/);

  if (!earningsSection) return earnings;

  const lines = earningsSection[1].split('\n').filter(line => line.trim());

  // Regex: Standard earnings format with rate
  // Matches: "Salary $150.00 86.67 $9,350.00 173.34 $18,700.00"
  // Groups: (1)name (2)rate (3)periodHours (4)periodAmount (5)ytdHours (6)ytdAmount
  const EARNINGS_WITH_RATE = /^(.+?)\s+(-|\$[\d,]+\.?\d*)\s+([\d.]+)\s+\$([0-9,]+\.\d{2})\s+([\d.]+)\s+\$([0-9,]+\.\d{2})/;

  // Regex: Earnings without rate (reimbursements, bonuses)
  // Matches: "Reimbursement 1.00 $100.00 1.00 $100.00"
  // Groups: (1)name (2)periodHours (3)periodAmount (4)ytdHours (5)ytdAmount
  const EARNINGS_NO_RATE = /^([A-Za-z\s]+)-?\s+([\d.]+)\s+\$([0-9,]+\.\d{2})\s+([\d.]+)\s+\$([0-9,]+\.\d{2})/;

  for (const line of lines) {
    // Try to match standard format with rate
    let match = line.match(EARNINGS_WITH_RATE);

    if (match) {
      earnings.push({
        name: match[1].trim(),
        rate: parseCurrency(match[2]),
        payPeriodHours: parseHours(match[3]),
        payPeriodAmount: parseCurrency(match[4]),
        ytdHours: parseHours(match[5]),
        ytdAmount: parseCurrency(match[6])
      });
      continue;
    }

    // Try to match reimbursement format (no rate field)
    match = line.match(EARNINGS_NO_RATE);

    if (match) {
      earnings.push({
        name: match[1].trim(),
        rate: null,
        payPeriodHours: parseHours(match[2]),
        payPeriodAmount: parseCurrency(match[3]),
        ytdHours: parseHours(match[4]),
        ytdAmount: parseCurrency(match[5])
      });
    }
  }

  return earnings;
}

// Extract employee taxes section
function extractTaxes(text) {
  const taxes = [];
  const taxSection = text.match(/EMPLOYEE TAXES([\s\S]*?)DEDUCTIONS/);

  if (!taxSection) return taxes;

  const lines = taxSection[1].split('\n').filter(line => line.trim());

  // Regex: Tax line format
  // Matches: "Federal Income Tax$1,234.56$12,345.67"
  // Groups: (1)name (2)periodAmount (3)ytdAmount
  const TAX_LINE = /^(.+?)\$([0-9,]+\.\d{2})\$([0-9,]+\.\d{2})/;

  for (const line of lines) {
    // Skip header lines
    if (line.includes('CURRENT PERIOD') || line.includes('YTD AMOUNT')) {
      continue;
    }

    const match = line.match(TAX_LINE);

    if (match) {
      taxes.push({
        name: match[1].trim(),
        payPeriodAmount: parseCurrency(match[2]),
        ytdAmount: parseCurrency(match[3])
      });
    }
  }

  return taxes;
}

// Extract deductions section
function extractDeductions(text) {
  const deductions = [];
  const deductionSection = text.match(/DEDUCTIONS([\s\S]*?)SUMMARY/);

  if (!deductionSection) return deductions;

  const lines = deductionSection[1].split('\n');

  // Regex: Deduction line format (4 dollar amounts)
  // Matches: "401K (401K)$500.00$250.00$6,000.00$3,000.00"
  // Groups: (1)name (2)periodEmpDeduction (3)periodCoContrib (4)ytdEmpDeduction (5)ytdCoContrib
  const DEDUCTION_LINE = /^(.*?)\$([0-9,]+\.\d{2})\$([0-9,]+\.\d{2})\$([0-9,]+\.\d{2})\$([0-9,]+\.\d{2})/;

  let i = 0;
  let nameParts = [];

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip header lines
    if (line.includes('CURRENT EMP') || line.includes('DEDUCTION') ||
        line.includes('CURRENT CO') || line.includes('CONTRIBUTION') ||
        line.includes('YTD EMP') || line.includes('YTD CO') || !line) {
      i++;
      continue;
    }

    // Check if this line has the amounts (4 dollar amounts)
    const match = line.match(DEDUCTION_LINE);

    if (match) {
      if (match[1].trim()) {
        nameParts.push(match[1].trim());
      }

      const name = nameParts.join(' ');

      deductions.push({
        name: name,
        payPeriodEmployeeDeduction: parseCurrency(match[2]),
        payPeriodCompanyContribution: parseCurrency(match[3]),
        ytdEmployeeDeduction: parseCurrency(match[4]),
        ytdCompanyContribution: parseCurrency(match[5])
      });

      nameParts = [];
      i++;
    } else {
      nameParts.push(line);
      i++;
    }
  }

  return deductions;
}

// Extract summary section
function extractSummary(text) {
  const summary = {
    grossPay: null,
    netPay: null,
    totalTaxes: null,
    totalDeductions: null,
    categoryFlow: {
      earnings: 'addition',
      taxes: 'subtraction',
      deductions: 'subtraction',
      employerContributions: 'separate'
    }
  };

  // Extract gross pay
  const grossPayMatch = text.match(/GROSS PAY[:\s]*\$([0-9,]+\.\d{2})/i);
  if (grossPayMatch) {
    summary.grossPay = parseCurrency(grossPayMatch[1]);
  }

  // Extract net pay
  const netPayMatch = text.match(/NET PAY[:\s]*\$([0-9,]+\.\d{2})/i);
  if (netPayMatch) {
    summary.netPay = parseCurrency(netPayMatch[1]);
  }

  // Extract summary section for deductions and taxes totals
  const summarySection = text.match(/SUMMARY([\s\S]*?)(?:EARNINGS|EMPLOYEE TAXES)/);
  if (summarySection) {
    // Look for deductions total in summary
    const deductionsMatch = summarySection[1].match(/Deductions[:\s]*\$([0-9,]+\.\d{2})/i);
    if (deductionsMatch) {
      summary.totalDeductions = parseCurrency(deductionsMatch[1]);
    }

    // Look for taxes total in summary
    const taxesMatch = summarySection[1].match(/Taxes[:\s]*\$([0-9,]+\.\d{2})/i);
    if (taxesMatch) {
      summary.totalTaxes = parseCurrency(taxesMatch[1]);
    }
  }

  return summary;
}

// Validate parsed paystub data and warn about issues
function validatePaystub(paystub, filePath) {
  const warnings = [];
  const filename = path.basename(filePath);

  if (!paystub.payPeriod) {
    warnings.push('Missing pay period');
  }
  if (!paystub.earnings || paystub.earnings.length === 0) {
    warnings.push('No earnings found');
  }
  if (!paystub.taxes || paystub.taxes.length === 0) {
    warnings.push('No taxes found');
  }
  if (!paystub.summary || paystub.summary.grossPay === null) {
    warnings.push('Missing gross pay in summary');
  }
  if (!paystub.summary || paystub.summary.netPay === null) {
    warnings.push('Missing net pay in summary');
  }

  if (warnings.length > 0) {
    logger.warn(`Parsing ${filename}: ${warnings.join(', ')}`);
  }

  return paystub;
}

// Parse a single PDF file
async function parsePaystub(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const text = pdfData.text;

  const paystub = {
    payPeriod: extractPayPeriod(text),
    earnings: extractEarnings(text),
    taxes: extractTaxes(text),
    deductions: extractDeductions(text),
    summary: extractSummary(text)
  };

  return validatePaystub(paystub, filePath);
}

// Find all PDF files recursively
function findPDFFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      results = results.concat(findPDFFiles(filePath));
    } else if (file.toLowerCase().endsWith('.pdf')) {
      results.push(filePath);
    }
  });

  return results;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const rangeArg = args.find(arg => arg.startsWith('--range='));

  if (!rangeArg) {
    return null;
  }

  const rangeValue = rangeArg.split('=')[1];

  if (rangeValue === 'ytd') {
    // Year to date: Jan 1 of current year to today
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return { start: startOfYear, end: now, type: 'ytd' };
  }

  if (rangeValue === 'month') {
    // Current month: first day to last day of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: startOfMonth, end: endOfMonth, type: 'month' };
  }

  // Custom range: YYYY-MM-DD:YYYY-MM-DD
  if (rangeValue.includes(':')) {
    const [startStr, endStr] = rangeValue.split(':');
    const start = new Date(startStr);
    const end = new Date(endStr);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      logger.error('Invalid date format. Use YYYY-MM-DD:YYYY-MM-DD');
      process.exit(1);
    }

    return { start, end, type: 'custom' };
  }

  logger.error('Invalid range format. Use --range=YYYY-MM-DD:YYYY-MM-DD, --range=ytd, or --range=month');
  process.exit(1);
}

// Filter paystubs by date range
function filterByDateRange(paystubs, range) {
  if (!range) {
    return paystubs;
  }

  return paystubs.filter(paystub => {
    // Parse the pay period start date using safe helper
    const payPeriodStart = parsePayPeriodDate(paystub.payPeriod, 0);

    // Skip paystubs with invalid dates
    if (!payPeriodStart) {
      logger.warn(`Skipping paystub with invalid pay period: ${paystub.payPeriod}`);
      return false;
    }

    // Check if pay period start falls within the range
    return payPeriodStart >= range.start && payPeriodStart <= range.end;
  });
}

// Main function
async function main() {
  const paystubsDir = path.join(__dirname, 'Rippling_paystubs');

  if (!fs.existsSync(paystubsDir)) {
    logger.error(`Directory not found: ${paystubsDir}`);
    process.exit(1);
  }

  logger.info('Finding PDF files...');
  const pdfFiles = findPDFFiles(paystubsDir);
  logger.info(`Found ${pdfFiles.length} PDF files`);

  const results = [];

  for (const pdfFile of pdfFiles) {
    logger.info(`Parsing: ${path.basename(pdfFile)}`);
    try {
      const data = await parsePaystub(pdfFile);
      results.push(data);
    } catch (error) {
      logger.error(`Failed to parse ${path.basename(pdfFile)}: ${error.message}`);
    }
  }

  // Sort by pay period date
  results.sort((a, b) => {
    const dateA = parsePayPeriodDate(a.payPeriod, 0);
    const dateB = parsePayPeriodDate(b.payPeriod, 0);
    // Handle null dates by putting them at the end
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA - dateB;
  });

  // Apply date range filter
  const range = parseArgs();
  const filteredResults = filterByDateRange(results, range);

  if (range) {
    logger.info(`Filtering by ${range.type} range: ${range.start.toLocaleDateString()} to ${range.end.toLocaleDateString()}`);
    logger.info(`Paystubs in range: ${filteredResults.length} of ${results.length}`);
  }

  // Compute the actual date range from the filtered results
  let startDate, endDate;
  if (filteredResults.length > 0) {
    // Get the start date of the first paystub (results are already sorted)
    startDate = parsePayPeriodDate(filteredResults[0].payPeriod, 0);

    // Get the end date of the last paystub
    const lastPayPeriod = filteredResults[filteredResults.length - 1].payPeriod;
    endDate = parsePayPeriodDate(lastPayPeriod, 1);

    if (!startDate || !endDate) {
      logger.warn('Could not determine date range from paystubs');
    }
  }

  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, 'output', 'paystubs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate filename based on date range
  let filename = 'paystubs.json';
  if (startDate && endDate) {
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    filename = `paystubs_${formatDate(startDate)}_${formatDate(endDate)}.json`;
  }

  // Write to JSON file
  const outputFile = path.join(outputDir, filename);
  fs.writeFileSync(outputFile, JSON.stringify(filteredResults, null, 2));
  logger.success(`Data written to: ${outputFile}`);
  logger.info(`Total paystubs in output: ${filteredResults.length}`);
}

main().catch(console.error);

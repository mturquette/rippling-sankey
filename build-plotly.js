import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COLORS,
  CATEGORY_GROUP_NAMES,
  CATEGORY_GROUP_COLORS,
  getLinkColor
} from './config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extract date range from filename
function extractDateRange(filename) {
  const match = filename.match(/paystubs_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json/);
  if (match) {
    return `${match[1]}_${match[2]}`;
  }
  return null;
}

// Find most recent paystubs file
function findMostRecentPaystubs() {
  const paystubsDir = path.join(__dirname, 'output', 'paystubs');

  if (!fs.existsSync(paystubsDir)) {
    logger.error(`Paystubs directory not found: ${paystubsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(paystubsDir)
    .filter(f => f.startsWith('paystubs_') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(paystubsDir, f),
      mtime: fs.statSync(path.join(paystubsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    logger.error(`No paystub files found in: ${paystubsDir}`);
    process.exit(1);
  }

  return files[0].path;
}

// Helper function to clean node names
function cleanNodeName(name, isEmployerOnly = false) {
  let cleaned = name;
  // Remove leading underscore
  if (cleaned.startsWith('_')) {
    cleaned = cleaned.substring(1);
  }
  // For employer-only items, remove " Deductions" suffix
  if (isEmployerOnly && cleaned.endsWith(' Deductions')) {
    cleaned = cleaned.substring(0, cleaned.length - ' Deductions'.length);
  }
  // Normalize 401K naming
  cleaned = cleaned.replace('401K (401K)', '401(k)');
  return cleaned;
}

// Aggregate items by name from paystubs using accessor functions
function aggregateByName(paystubs, getItems, getValue) {
  const map = new Map();
  paystubs.forEach(paystub => {
    const items = getItems(paystub) || [];
    items.forEach(item => {
      const current = map.get(item.name) || 0;
      map.set(item.name, current + (getValue(item) || 0));
    });
  });
  return Array.from(map.entries())
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
}

// Build Sankey diagram data from paystubs
function buildSankeyData(paystubs) {
  // Aggregate all categories using the helper
  const earnings = aggregateByName(paystubs, p => p.earnings, e => e.payPeriodAmount);
  const taxes = aggregateByName(paystubs, p => p.taxes, t => t.payPeriodAmount);
  const deductions = aggregateByName(paystubs, p => p.deductions, d => d.payPeriodEmployeeDeduction);
  const employerContributions = aggregateByName(paystubs, p => p.deductions, d => d.payPeriodCompanyContribution);

  // Calculate totals for each category
  const categoryTotals = {
    earnings: earnings.reduce((sum, e) => sum + e.value, 0),
    taxes: taxes.reduce((sum, t) => sum + t.value, 0),
    deductions: deductions.reduce((sum, d) => sum + d.value, 0),
    employerContributions: employerContributions.reduce((sum, c) => sum + c.value, 0)
  };

  // Track which categories have non-zero values
  const activeCategoryGroups = Object.keys(categoryTotals)
    .filter(category => categoryTotals[category] > 0)
    .map(category => ({
      key: category,
      name: CATEGORY_GROUP_NAMES[category],
      total: categoryTotals[category],
      color: CATEGORY_GROUP_COLORS[category]
    }));

  // For backward compatibility with variable names
  const totalEarnings = categoryTotals.earnings;
  const totalTaxes = categoryTotals.taxes;
  const totalDeductions = categoryTotals.deductions;
  const totalEmployerContributions = categoryTotals.employerContributions;

  // Extract category flow metadata from first paystub's summary
  const summaryMetadata = paystubs[0]?.summary?.categoryFlow || {
    earnings: 'addition',
    taxes: 'subtraction',
    deductions: 'subtraction',
    employerContributions: 'separate'
  };

  // Find salary as the primary earnings (required)
  // Salary flows through withholding and deductions
  const salary = earnings.find(e => e.name === 'Salary');

  if (!salary) {
    logger.error('No Salary earnings found in paystubs');
    process.exit(1);
  }

  // Separate salary from other earnings (e.g., reimbursements, bonuses)
  // Other earnings flow directly to net pay without withholding/deductions
  const otherEarnings = earnings.filter(e => e.name !== 'Salary');

  // Calculate net pay (round to 2 decimal places to avoid floating point errors)
  const totalOtherEarnings = otherEarnings.reduce((sum, e) => sum + e.value, 0);
  const netPay = Math.round((salary.value - totalTaxes - totalDeductions + totalOtherEarnings) * 100) / 100;

  // Build nodes list
  const nodes = [];
  const nodeIndices = new Map();

  function addNode(label, color) {
    // Check for duplicate node labels
    if (nodeIndices.has(label)) {
      logger.warn(`Duplicate node label "${label}" - using existing index`);
      return nodeIndices.get(label);
    }
    const index = nodes.length;
    nodes.push({ label, color });
    nodeIndices.set(label, index);
    return index;
  }

  // Add root node
  addNode('Total Compensation', COLORS.totalCompensationRoot);

  // Add dynamic category group nodes for all active categories
  activeCategoryGroups.forEach(category => {
    addNode(category.name, category.color);
  });

  // Add individual line items within each category
  if (activeCategoryGroups.find(c => c.key === 'earnings')) {
    // Add salary node (primary earnings)
    addNode('Salary', COLORS.salary);

    // Add nodes for other earnings types (reimbursements, bonuses, etc.)
    otherEarnings.forEach(earning => {
      const cleanName = cleanNodeName(earning.name, false);
      addNode(cleanName, COLORS.reimbursement);
    });
  }

  if (activeCategoryGroups.find(c => c.key === 'taxes')) {
    // Add individual tax items
    taxes.forEach(tax => {
      addNode(tax.name, COLORS.individualTax);
    });
  }

  if (activeCategoryGroups.find(c => c.key === 'deductions')) {
    // Add individual deduction nodes (those with employee contributions)
    deductions.forEach(deduction => {
      const cleanName = cleanNodeName(deduction.name, false);
      addNode(cleanName, COLORS.individualDeduction);
    });
  }

  if (activeCategoryGroups.find(c => c.key === 'employerContributions')) {
    // Add employer-only contributions (those without a matching employee deduction)
    employerContributions.forEach(contribution => {
      // Only add as separate node if there's no matching employee deduction
      if (!deductions.find(d => d.name === contribution.name)) {
        const cleanName = cleanNodeName(contribution.name, true);
        addNode(cleanName, COLORS.employerContribution);
      }
    });
  }

  // Add net pay node
  addNode('Net Pay', COLORS.netPay);

  // Build links
  const links = [];

  function addLink(sourceName, targetName, value, color) {
    const source = nodeIndices.get(sourceName);
    const target = nodeIndices.get(targetName);

    if (source === undefined || target === undefined) {
      logger.error(`Cannot find node for link ${sourceName} -> ${targetName}`);
      return;
    }

    links.push({ source, target, value, color });
  }

  // Helper to get category group display name
  function getCategoryGroupName(categoryKey) {
    return CATEGORY_GROUP_NAMES[categoryKey];
  }

  // Total Compensation -> Only root-level categories (additions and separate employer contributions)
  activeCategoryGroups
    .filter(category => {
      const flowType = summaryMetadata[category.key];
      // Only link additions (earnings) and separate (employer contributions) from root
      return flowType === 'addition' || flowType === 'separate';
    })
    .forEach(category => {
      addLink('Total Compensation', category.name, category.total, getLinkColor('#646464'));
    });

  // Earnings category -> Individual earnings items
  if (activeCategoryGroups.find(c => c.key === 'earnings')) {
    const earningsGroupName = getCategoryGroupName('earnings');
    addLink(earningsGroupName, 'Salary', salary.value, getLinkColor(COLORS.salary));

    otherEarnings.forEach(earning => {
      const cleanName = cleanNodeName(earning.name, false);
      addLink(earningsGroupName, cleanName, earning.value, getLinkColor(COLORS.reimbursement));
    });
  }

  // Salary -> Tax category
  if (activeCategoryGroups.find(c => c.key === 'taxes')) {
    const taxesGroupName = getCategoryGroupName('taxes');
    addLink('Salary', taxesGroupName, totalTaxes, getLinkColor(COLORS.taxesCategory));

    // Tax category -> Individual taxes
    taxes.forEach(tax => {
      addLink(taxesGroupName, tax.name, tax.value, getLinkColor(COLORS.individualTax));
    });
  }

  // Salary -> Deductions category
  if (activeCategoryGroups.find(c => c.key === 'deductions')) {
    const deductionsGroupName = getCategoryGroupName('deductions');
    addLink('Salary', deductionsGroupName, totalDeductions, getLinkColor(COLORS.deductionsCategory));

    // Deductions category -> Individual deductions
    deductions.forEach(deduction => {
      const cleanName = cleanNodeName(deduction.name, false);
      addLink(deductionsGroupName, cleanName, deduction.value, getLinkColor(COLORS.individualDeduction));
    });
  }

  // Employer Contributions -> Individual contributions
  if (activeCategoryGroups.find(c => c.key === 'employerContributions')) {
    const employerGroupName = getCategoryGroupName('employerContributions');
    employerContributions.forEach(contribution => {
      // Check if there's a matching employee deduction
      const hasMatchingDeduction = deductions.find(d => d.name === contribution.name);
      // Use isEmployerOnly=true only if there's no matching employee deduction
      const cleanName = cleanNodeName(contribution.name, !hasMatchingDeduction);
      addLink(employerGroupName, cleanName, contribution.value, getLinkColor(COLORS.employerContribution));
    });
  }

  // Salary/Primary Earnings -> Net Pay
  const salaryToNetPay = salary.value - totalTaxes - totalDeductions;
  addLink('Salary', 'Net Pay', salaryToNetPay, getLinkColor(COLORS.netPay));

  // Other earnings -> Net Pay (direct, no withholding/deductions)
  otherEarnings.forEach(earning => {
    const cleanName = cleanNodeName(earning.name, false);
    addLink(cleanName, 'Net Pay', earning.value, getLinkColor(COLORS.netPay));
  });

  return { nodes, links };
}

// Main function
function main() {
  // Get input file from command line or find most recent
  let inputFile = process.argv[2];

  if (!inputFile) {
    logger.info('No input file specified, finding most recent paystubs file...');
    inputFile = findMostRecentPaystubs();
  }

  if (!path.isAbsolute(inputFile)) {
    inputFile = path.resolve(inputFile);
  }

  if (!fs.existsSync(inputFile)) {
    logger.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  logger.info(`Reading: ${inputFile}`);

  // Read and parse paystubs
  const paystubs = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

  if (!Array.isArray(paystubs) || paystubs.length === 0) {
    logger.error('Invalid or empty paystubs data');
    process.exit(1);
  }

  logger.info(`Processing ${paystubs.length} paystub(s)...`);

  // Build Sankey data
  const sankeyData = buildSankeyData(paystubs);

  // Extract date range from filename
  const dateRange = extractDateRange(path.basename(inputFile));

  if (!dateRange) {
    logger.warn('Could not extract date range from filename');
  }

  // Prepare output
  const output = {
    nodes: sankeyData.nodes,
    links: sankeyData.links,
    dateRange: dateRange
  };

  // Create output directory
  const outputDir = path.join(__dirname, 'output', 'plotly');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output file
  const outputFilename = dateRange
    ? `plotly_${dateRange}.json`
    : 'plotly.json';
  const outputPath = path.join(outputDir, outputFilename);

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  logger.success(`Sankey data written to: ${outputPath}`);
  logger.info(`Nodes: ${sankeyData.nodes.length}`);
  logger.info(`Links: ${sankeyData.links.length}`);
}

main();

// Centralized configuration for the Rippling Sankey diagram project

// Color scheme for Sankey diagram nodes
export const COLORS = {
  totalCompensationRoot: '#1a472a',
  earningsRoot: '#28a745',
  salary: '#90EE90',
  reimbursement: '#98FB98',
  earningsCategory: '#28a745',
  taxesCategory: '#dc3545',
  individualTax: '#F08080',
  deductionsCategory: '#007bff',
  individualDeduction: '#87CEEB',
  employerContributionsCategory: '#f39c12',
  employerContribution: '#ffd699',
  netPay: '#006400'
};

// Opacity for link colors in Sankey diagram
export const LINK_OPACITY = 0.4;

// Category group name mapping: raw key -> display name
export const CATEGORY_GROUP_NAMES = {
  earnings: 'Earnings / Gross Pay',
  taxes: 'Withholding',
  deductions: 'Deductions',
  employerContributions: 'Employer Contributions'
};

// Category group colors
export const CATEGORY_GROUP_COLORS = {
  earnings: COLORS.earningsCategory,
  taxes: COLORS.taxesCategory,
  deductions: COLORS.deductionsCategory,
  employerContributions: COLORS.employerContributionsCategory
};

// Directory paths
export const PATHS = {
  paystubsInput: 'Rippling_paystubs',
  paystubsOutput: 'output/paystubs',
  plotlyOutput: 'output/plotly',
  renderOutput: 'output/render'
};

// Chart configuration for rendering
export const CHART_CONFIG = {
  nodeThickness: 30,
  nodePadding: 15,
  lineWidth: 2,
  chartHeight: 800,
  containerMaxWidth: 1400
};

// Convert hex color to rgba with configured opacity
export function getLinkColor(hexColor, opacity = LINK_OPACITY) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

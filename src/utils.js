import chalk from 'chalk';
import dns from 'dns/promises';

/**
 * Delays execution for the specified number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates whether a string is a well-formed email address.
 * @param {string} email 
 * @returns {boolean}
 */
export const isValidEmail = (email) => {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

/**
 * Validates whether a string looks like a website domain or URL.
 * @param {string} url 
 * @returns {boolean}
 */
export const isValidDomain = (url) => {
  if (!url) return false;
  // Simple regex for domains (e.g. google.com, test.co.uk)
  const re = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
  // If it's a full URL, we extract the hostname
  try {
    let checkStr = url;
    if (url.includes('://')) {
      checkStr = new URL(url).hostname;
    }
    return re.test(checkStr);
  } catch {
    return re.test(url);
  }
};

/**
 * Clean domain string (removes protocol, path, query, etc.)
 * @param {string} url 
 * @returns {string}
 */
export const cleanDomain = (url) => {
  if (!url) return '';
  let domain = url.trim().toLowerCase();
  if (domain.includes('://')) {
    try {
      domain = new URL(domain).hostname;
    } catch {
      // fallback if new URL fails
      domain = domain.split('://')[1].split('/')[0];
    }
  } else {
    domain = domain.split('/')[0];
  }
  // remove www. if present
  return domain.startsWith('www.') ? domain.substring(4) : domain;
};

// Logging helpers
export const log = {
  success: (msg) => console.log(chalk.green('✔ ') + msg),
  error: (msg) => console.error(chalk.red('✖ ') + chalk.red.bold('Error: ') + msg),
  info: (msg) => console.log(chalk.blue('ℹ ') + msg),
  warn: (msg) => console.log(chalk.yellow('⚠ ') + chalk.yellow.bold('Warning: ') + msg),
  highlight: (msg) => chalk.cyan(msg),
  bold: (msg) => chalk.bold(msg),
  dim: (msg) => chalk.gray(msg),
};

/**
 * Prints a beautiful banner for the CLI tool.
 */
export const printBanner = () => {
  console.log('\n' + chalk.cyan.bold('===================================================='));
  console.log(chalk.cyan.bold('          🚀 COLD OUTREACH PIPELINE CLI v1.0.0      '));
  console.log(chalk.cyan.bold('====================================================') + '\n');
};

/**
 * Prints a section header.
 * @param {string} title 
 */
export const printHeader = (title) => {
  console.log('\n' + chalk.magenta.bold(`--- ${title.toUpperCase()} ---`) + '\n');
};

/**
 * Checks if a domain has active MX (Mail Exchange) records.
 * @param {string} domain 
 * @returns {Promise<boolean>}
 */
export const hasMailServer = async (domain) => {
  if (!domain) return false;
  try {
    const mxRecords = await dns.resolveMx(domain);
    return mxRecords && mxRecords.length > 0;
  } catch (err) {
    return false;
  }
};

import chalk from 'chalk';
import { log, sleep } from './utils.js';

// Database of realistic mock companies
const MOCK_COMPANIES = [
  { name: 'Stripe, Inc.', domain: 'stripe.com' },
  { name: 'Airbnb, Inc.', domain: 'airbnb.com' },
  { name: 'Vercel Inc.', domain: 'vercel.com' },
  { name: 'Retool, Inc.', domain: 'retool.com' },
  { name: 'Figma, Inc.', domain: 'figma.com' }
];

// Database of realistic mock contacts
const MOCK_CONTACTS = {
  'stripe.com': [
    { firstName: 'Patrick', lastName: 'Collison', title: 'Co-Founder & CEO', linkedinUrl: 'https://www.linkedin.com/in/patrickcollison', companyName: 'Stripe, Inc.', domain: 'stripe.com' },
    { firstName: 'John', lastName: 'Collison', title: 'Co-Founder & President', linkedinUrl: 'https://www.linkedin.com/in/johncollison', companyName: 'Stripe, Inc.', domain: 'stripe.com' }
  ],
  'airbnb.com': [
    { firstName: 'Brian', lastName: 'Chesky', title: 'Co-Founder & CEO', linkedinUrl: 'https://www.linkedin.com/in/brianchesky', companyName: 'Airbnb, Inc.', domain: 'airbnb.com' },
    { firstName: 'Nathan', lastName: 'Blecharczyk', title: 'Co-Founder & Chief Strategy Officer', linkedinUrl: 'https://www.linkedin.com/in/nathanblecharczyk', companyName: 'Airbnb, Inc.', domain: 'airbnb.com' }
  ],
  'vercel.com': [
    { firstName: 'Guillermo', lastName: 'Rauch', title: 'Founder & CEO', linkedinUrl: 'https://www.linkedin.com/in/guillermorauch', companyName: 'Vercel Inc.', domain: 'vercel.com' },
    { firstName: 'Lee', lastName: 'Robinson', title: 'VP of Product', linkedinUrl: 'https://www.linkedin.com/in/leerobinson', companyName: 'Vercel Inc.', domain: 'vercel.com' }
  ]
};

// Default fallback contacts for any other domains
const getFallbackContacts = (domain) => {
  const companyName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) + ' Corp';
  return [
    { firstName: 'Sarah', lastName: 'Jenkins', title: 'Founder & CEO', linkedinUrl: `https://www.linkedin.com/in/sarahjenkins-${domain.split('.')[0]}`, companyName, domain },
    { firstName: 'David', lastName: 'Miller', title: 'VP of Engineering', linkedinUrl: `https://www.linkedin.com/in/davidmiller-${domain.split('.')[0]}`, companyName, domain }
  ];
};

/**
 * Simulates company search (Stage 1)
 */
export async function mockSearchCompanies(query, limit = 5, provider = 'apollo') {
  await sleep(1000); // Simulate API latency
  log.info(`[MOCK] Searching companies on ${provider.toUpperCase()} matching keyword: "${query}"`);
  
  // Filter or return mock companies
  const filtered = MOCK_COMPANIES.filter(c => 
    c.name.toLowerCase().includes(query.toLowerCase()) || 
    c.domain.toLowerCase().includes(query.toLowerCase())
  );
  
  const results = filtered.length > 0 ? filtered : MOCK_COMPANIES;
  return results.slice(0, limit);
}

/**
 * Simulates finding contacts (Stage 2)
 */
export async function mockFindContacts(domain, limit = 2) {
  await sleep(800); // Simulate API latency
  log.info(`[MOCK] Fetching C-Level/VP decision makers at domain: ${domain}`);
  
  const contacts = MOCK_CONTACTS[domain] || getFallbackContacts(domain);
  return contacts.slice(0, limit);
}

/**
 * Simulates enriching contacts (Stage 3)
 */
export async function mockEnrichContact(contact) {
  await sleep(800); // Simulate API latency
  log.info(`[MOCK] Running Prospeo email-finder enrichment for: ${contact.firstName} ${contact.lastName}`);
  
  // Generate a mock email address
  const email = `${contact.firstName.toLowerCase()}.${contact.lastName.toLowerCase()}@${contact.domain}`;
  
  return {
    email,
    emailStatus: 'verified',
    linkedinUrl: contact.linkedinUrl || `https://www.linkedin.com/in/${contact.firstName.toLowerCase()}${contact.lastName.toLowerCase()}`,
    firstName: contact.firstName,
    lastName: contact.lastName
  };
}

/**
 * Simulates sending email (Stage 4)
 */
export async function mockSendEmail(emailDetails, senderEmail, senderName) {
  await sleep(1200); // Simulate SMTP latency
  
  console.log('\n' + chalk.yellow('┌──────────────────────────────────────────────────────────'));
  console.log(chalk.yellow('│ ') + chalk.bold.cyan('📧 OUTBOUND EMAIL SIMULATOR (MOCK)'));
  console.log(chalk.yellow('├──────────────────────────────────────────────────────────'));
  console.log(chalk.yellow('│ ') + chalk.bold('From:    ') + `${senderName} <${senderEmail}>`);
  console.log(chalk.yellow('│ ') + chalk.bold('To:      ') + `${emailDetails.toName} <${emailDetails.toEmail}>`);
  console.log(chalk.yellow('│ ') + chalk.bold('Subject: ') + emailDetails.subject);
  console.log(chalk.yellow('├──────────────────────────────────────────────────────────'));
  
  // Format body output
  const bodyLines = emailDetails.bodyText.split('\n');
  bodyLines.forEach(line => {
    console.log(chalk.yellow('│ ') + line);
  });
  console.log(chalk.yellow('└──────────────────────────────────────────────────────────') + '\n');
  
  log.success(`[MOCK] outreach email sent to ${emailDetails.toEmail} successfully!`);
  return true;
}

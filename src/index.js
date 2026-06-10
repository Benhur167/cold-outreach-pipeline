import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import axios from 'axios';

import {
  log,
  printBanner,
  printHeader,
  sleep,
  cleanDomain,
  isValidDomain,
  isValidEmail,
  hasMailServer
} from './utils.js';

// Real API imports
import { searchCompanies as oceanSearch } from './ocean.js';
import { searchCompanies as apolloSearch } from './apollo.js';
import { findContactsForDomain, enrichContact } from './prospeo.js';
import { sendColdEmail, compileTemplate } from './brevo.js';
import { discoverHiringCompanies, resolveCompanyDomain } from './jobs.js';
import { searchContactsByDomain } from './hunter.js';

// Mock API imports
import {
  mockSearchCompanies,
  mockFindContacts,
  mockEnrichContact,
  mockSendEmail
} from './mock.js';

const program = new Command();

program
  .name('cold-outreach-pipeline')
  .description('Automated cold-outreach pipeline using Ocean.io/Apollo.io, Prospeo, and Brevo')
  .version('1.0.0')
  .option('-m, --mock', 'Run the pipeline in simulation (mock) mode')
  .option('-p, --provider <provider>', 'Company search provider (jobs, ocean, apollo, or manual)')
  .option('-q, --query <query>', 'Keyword/search term for finding companies')
  .option('-d, --domain <domain>', 'Process outreach for a single target domain directly')
  .option('-l, --limit <number>', 'Maximum number of companies to fetch', parseInt, 5)
  .option('-c, --contact-limit <number>', 'Maximum contacts to enrich per company', parseInt, 2)
  .option('-s, --send', 'Send emails automatically without prompting')
  .option('-y, --seniorities <seniorities>', 'Comma-separated list of seniorities to query (or "All")')
  .option('-t, --titles <titles>', 'Comma-separated list of job titles to query (or "All")')
  .option('--resume-path <path>', 'Local path to PDF resume file to attach')
  .option('--resume-url <url>', 'URL of a public PDF resume to attach')
  .option('--strict', 'Strict mode: only send to 100% verified emails (exclude catch_all)')
  .option('--jobs-category <category>', 'Job category for discovery (default: "Software Engineering")')
  .option('--jobs-level <level>', 'Career seniority level for discovery (default: "Internship")')
  .option('--jobs-location <location>', 'Job location for discovery (e.g. "India", "Remote")');

program.parse(process.argv);
const options = program.opts();

// Check if any arguments were provided to skip interactive mode
const hasCliArguments = options.provider || options.query || options.domain || options.mock || program.args.length > 0;

// Presets for job, internship, and business outreach targets
const TARGET_PRESETS = {
  hr: {
    name: 'HR & Talent Acquisition Team (Recruiter, Talent Acquisition, HR Executive)',
    seniorities: ['Director', 'Manager', 'Senior', 'Entry'],
    titles: ['Recruiter', 'Talent Acquisition Specialist', 'Talent Acquisition Partner', 'HR Executive', 'HR Manager', 'Talent Acquisition Manager', 'Talent Acquisition Lead', 'Campus Recruiter', 'University Recruiter']
  },
  tech: {
    name: 'Engineering & Tech Leadership (CTO, VP Engineering, Engineering Manager, Tech Lead)',
    seniorities: ['Founder/Owner', 'C-Suite', 'Vice President', 'Director', 'Manager'],
    titles: ['CTO', 'Chief Technology Officer', 'Head of Engineering', 'Director of Engineering', 'VP of Engineering', 'Engineering Manager', 'Software Development Manager', 'Technical Lead', 'Lead Developer', 'Engineering Lead']
  },
  founders: {
    name: 'Startup Founders & CEOs (CEO, Founders, Co-Founders - best for small startups)',
    seniorities: ['Founder/Owner', 'C-Suite'],
    titles: ['CEO', 'Founder', 'Co-Founder', 'President']
  },
  campus: {
    name: 'Campus & University Recruitment (Campus Recruiter, University Recruiter)',
    seniorities: ['Senior', 'Entry', 'Manager'],
    titles: ['Campus Recruiter', 'University Recruiter', 'Campus Recruitment Specialist']
  },
  executives: {
    name: 'General Decision Makers / Executives (Founders, C-Suite, VPs - Default)',
    seniorities: ['Founder/Owner', 'C-Suite', 'Vice President'],
    titles: ['All']
  },
  all: {
    name: 'All Employees (No Filters - Best for micro-startups)',
    seniorities: ['All'],
    titles: ['All']
  },
  custom: {
    name: 'Custom Filters (Enter custom job titles & seniorities)',
    seniorities: [],
    titles: []
  }
};

// Library of cold outreach templates optimized for internships, full-time jobs, and generic networking
const TEMPLATE_LIBRARY = [
  {
    name: 'Tech-focused SDE/Web/Android Internship Inquiry (Highlights GitHub/Projects)',
    subject: 'SDE Internship / Software Engineering at <COMPANY_NAME>',
    body: 'Hi <FIRST_NAME>,\n\nI\'m a software engineering student, and I\'ve been following <COMPANY_NAME>\'s growth. I noticed you lead the team as <TITLE> and wanted to reach out.\n\nI\'m looking for an SDE/Web/Android internship and would love to contribute to your engineering team. I build full-stack web and mobile projects (using Node.js, React, and Android), and I\'m used to shipping code quickly.\n\nHere is my GitHub profile: <SENDER_GITHUB>\nAnd my portfolio is here: <SENDER_PORTFOLIO>\n\nI\'ve also attached/linked my resume for your review. Do you have 5 minutes for a quick chat next week about potential opportunities on your team?\n\nBest,\n<SENDER_NAME>'
  },
  {
    name: 'Full-Time SDE/Developer Job Application (Highlights Skills & Resume)',
    subject: 'SDE Role / Software Developer Opportunity at <COMPANY_NAME>',
    body: 'Hi <FIRST_NAME>,\n\nI noticed you are working at <COMPANY_NAME> as <TITLE>. I\'ve admire the product you are building and wanted to reach out regarding software development roles.\n\nI am a Software Developer with experience building responsive web apps and scalable backend APIs using React, Node.js, and SQL/NoSQL databases. I\'m passionate about writing clean, testable code and shipping robust user experiences.\n\nHere is my GitHub profile: <SENDER_GITHUB>\nAnd my portfolio: <SENDER_PORTFOLIO>\n\nI have attached my resume for reference. Would you be open to a brief call this week to see if my background aligns with your team\'s needs?\n\nBest,\n<SENDER_NAME>'
  },
  {
    name: 'Developer Peer Referral / Advice Connection (Soft-pitch, networking focus)',
    subject: 'Quick question from an aspiring developer',
    body: 'Hi <FIRST_NAME>,\n\nI saw your profile and noticed you work at <COMPANY_NAME> as <TITLE>. I\'m an aspiring software developer looking to get into the startup space, and I really admire the tech stack you use.\n\nI\'m currently looking for developer opportunities to grow my skills. If you have any advice or know if your team is looking for talent, I\'d love to connect.\n\nHere is my GitHub ( <SENDER_GITHUB> ) and my portfolio ( <SENDER_PORTFOLIO> ). My resume is attached.\n\nThanks for your time!\n\nBest,\n<SENDER_NAME>'
  },
  {
    name: 'Default Cold Connection (Original template)',
    subject: 'Quick question regarding <COMPANY_NAME>',
    body: 'Hi <FIRST_NAME>,\n\nI noticed you are leading the team at <COMPANY_NAME> as <TITLE>. I\'d love to connect.\n\nBest,\n<SENDER_NAME>'
  }
];


/**
 * Converts a Google Drive link to a direct download link if applicable.
 */
export function convertToDirectLink(url) {
  if (!url) return '';
  if (url.includes('drive.google.com')) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }
  return url;
}

/**
 * Downloads a remote file and converts it to a base64 attachment object for Brevo.
 */
export async function resolveUrlAttachment(url, filename = 'resume.pdf') {
  const convertedUrl = convertToDirectLink(url);
  try {
    const response = await axios.get(convertedUrl, { 
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    // Check if the response content is HTML (meaning Google Drive returned a preview page instead of direct download)
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      throw new Error('URL returned an HTML webpage instead of a binary PDF. Please make sure your Google Drive link is shared publicly.');
    }
    
    const base64Content = Buffer.from(response.data).toString('base64');
    return {
      content: base64Content,
      name: filename
    };
  } catch (err) {
    throw new Error(`Failed to retrieve file from URL: ${err.message}`);
  }
}

/**
 * Fetches contacts at a domain, automatically widening filters if no results are found,
 * and falling back to Hunter.io if available.
 */
async function fetchContactsWithFallback(domain, contactLimit, seniorities, titles, isMock, companyName = '') {
  let contacts = [];

  // 1. Try with initial filters first
  try {
    contacts = isMock
      ? await mockFindContacts(domain, contactLimit, seniorities, titles)
      : await findContactsForDomain(domain, contactLimit, seniorities, titles);
    
    if (contacts.length > 0) return contacts;
  } catch (err) {
    if (!err.message.includes('NO_RESULTS')) {
      throw err; // Re-throw network or auth errors
    }
  }

  // 2. Widen fallback list: Campus Recruiter -> HR -> Tech Leadership -> Founders -> All Employees
  const fallbacks = [
    { name: 'Campus Recruiter', seniorities: ['Senior', 'Entry', 'Manager'], titles: ['Campus Recruiter', 'University Recruiter', 'Campus Recruitment Specialist'] },
    { name: 'HR/Talent', seniorities: ['Director', 'Manager', 'Senior', 'Entry'], titles: ['Recruiter', 'Talent Acquisition Specialist', 'Talent Acquisition Partner', 'HR Executive', 'HR Manager', 'Talent Acquisition Manager', 'Talent Acquisition Lead'] },
    { name: 'Tech Leadership', seniorities: ['Founder/Owner', 'C-Suite', 'Vice President', 'Director', 'Manager'], titles: ['CTO', 'Chief Technology Officer', 'Head of Engineering', 'Director of Engineering', 'VP of Engineering', 'Engineering Manager', 'Software Development Manager', 'Technical Lead', 'Lead Developer', 'Engineering Lead'] },
    { name: 'Founders & CEOs', seniorities: ['Founder/Owner', 'C-Suite'], titles: ['CEO', 'Founder', 'Co-Founder', 'President'] },
    { name: 'All Employees (No Filters)', seniorities: ['All'], titles: ['All'] }
  ];

  for (const preset of fallbacks) {
    // Skip if it is identical to what we already tried
    const isSameSeniority = JSON.stringify(preset.seniorities) === JSON.stringify(seniorities);
    const isSameTitle = JSON.stringify(preset.titles) === JSON.stringify(titles);
    if (isSameSeniority && isSameTitle) continue;

    try {
      log.info(`No contacts found with initial filters for ${domain}. Widening search to: ${preset.name}...`);
      contacts = isMock
        ? await mockFindContacts(domain, contactLimit, preset.seniorities, preset.titles)
        : await findContactsForDomain(domain, contactLimit, preset.seniorities, preset.titles);
      
      if (contacts.length > 0) {
        log.success(`Found ${contacts.length} contacts via ${preset.name} fallback for ${domain}!`);
        return contacts;
      }
    } catch (err) {
      if (!err.message.includes('NO_RESULTS')) {
        throw err;
      }
    }
  }

  // 3. Ultimate Fallback: Hunter.io
  const hunterKey = process.env.HUNTER_API_KEY;
  if (hunterKey && !hunterKey.includes('your_hunter_api_key_here') && !isMock) {
    log.info(`Prospeo returned no results for ${domain}. Trying Hunter.io Domain Search fallback...`);
    try {
      contacts = await searchContactsByDomain(domain, contactLimit, hunterKey);
      if (contacts.length > 0) {
        log.success(`Found ${contacts.length} contacts via Hunter.io fallback for ${domain}!`);
        return contacts;
      }
    } catch (err) {
      log.warn(`Hunter.io fallback search failed: ${err.message}`);
    }
  }

  throw new Error('NO_RESULTS');
}

async function main() {
  printBanner();

  if (hasCliArguments) {
    // Headless / CLI flag execution
    await runHeadlessPipeline();
  } else {
    // Interactive Wizard Mode
    await runInteractivePipeline();
  }
}

/**
 * Executes pipeline based on command-line flags.
 */
async function runHeadlessPipeline() {
  const isMock = !!options.mock;
  const provider = options.provider || 'apollo';
  const query = options.query;
  const domainInput = options.domain || program.args[0];
  const limit = options.limit;
  const contactLimit = options.contactLimit;
  const autoSend = !!options.send;
  const isStrict = !!options.strict;

  log.info(`Running pipeline in ${isMock ? 'MOCK' : 'PRODUCTION'} mode...`);

  // Parse filters from CLI arguments
  const seniorities = options.seniorities 
    ? options.seniorities.split(',').map(s => s.trim()) 
    : ['Founder/Owner', 'C-Suite', 'Vice President'];
  const titles = options.titles 
    ? options.titles.split(',').map(t => t.trim()) 
    : [];

  // Load and validate resume attachment if specified
  let attachment = null;
  if (options.resumePath) {
    try {
      const resolvedPath = path.resolve(options.resumePath);
      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath).toString('base64');
        attachment = {
          content: fileContent,
          name: path.basename(resolvedPath)
        };
        log.info(`Loaded local resume file to attach: ${path.basename(resolvedPath)}`);
      } else {
        log.error(`Local resume file not found at path: ${options.resumePath}`);
        process.exit(1);
      }
    } catch (err) {
      log.error(`Failed to read local resume file: ${err.message}`);
      process.exit(1);
    }
  } else if (options.resumeUrl) {
    try {
      attachment = await resolveUrlAttachment(options.resumeUrl, 'resume.pdf');
      log.info(`Using remote resume URL: ${options.resumeUrl} (Resolved to Base64)`);
    } catch (err) {
      log.error(`Failed to load remote resume from URL: ${err.message}`);
      process.exit(1);
    }
  }

  let companies = [];

  if (domainInput) {
    const cleaned = cleanDomain(domainInput);
    if (!isValidDomain(cleaned)) {
      log.error(`Invalid domain input: ${domainInput}`);
      process.exit(1);
    }
    companies = [{ name: cleaned.split('.')[0], domain: cleaned }];
  } else if (provider === 'manual') {
    if (!query) {
      log.error('Manual provider requires a query string containing comma-separated domains (e.g. --query "stripe.com,airbnb.com")');
      process.exit(1);
    }
    companies = query.split(',').map(d => {
      const cleaned = cleanDomain(d);
      return { name: cleaned.split('.')[0], domain: cleaned };
    }).filter(c => isValidDomain(c.domain));
  } else if (provider === 'jobs') {
    const jobsCategory = options.jobsCategory || 'Software Engineering';
    const jobsLevel = options.jobsLevel || 'Internship';
    const jobsLocation = options.jobsLocation || '';
    const spinner = ora(`Discovering hiring companies for "${jobsCategory}" ("${jobsLevel}"${jobsLocation ? `, "${jobsLocation}"` : ''})...`).start();
    try {
      const discovered = await discoverHiringCompanies(jobsCategory, jobsLevel, jobsLocation, limit, isMock);
      spinner.succeed(`Discovered ${discovered.length} hiring companies.`);
      
      const resolveSpinner = ora('Resolving domains for discovered companies...').start();
      for (const item of discovered) {
        resolveSpinner.text = `Resolving domain for ${item.name}...`;
        const domain = await resolveCompanyDomain(item.name, isMock);
        if (domain) {
          companies.push({ name: item.name, domain });
        }
      }
      resolveSpinner.succeed(`Resolved domains for ${companies.length} companies.`);
    } catch (err) {
      spinner.fail(`Job discovery failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Company search
    if (!query) {
      log.error('Company search requires a search query (e.g. --query "SaaS")');
      process.exit(1);
    }

    const spinner = ora(`Searching companies matching "${query}" using ${provider}...`).start();
    try {
      if (isMock) {
        companies = await mockSearchCompanies(query, limit, provider);
      } else if (provider === 'ocean') {
        companies = await oceanSearch(query, limit);
      } else {
        companies = await apolloSearch(query, limit);
      }
      spinner.succeed(`Found ${companies.length} companies.`);
    } catch (err) {
      spinner.fail(`Company search failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Offline MX Record Validation (Skip in Mock Mode)
  if (companies.length > 0 && !isMock) {
    const dnsSpinner = ora('Verifying company domain mail servers (MX records)...').start();
    const activeCompanies = [];
    for (const company of companies) {
      dnsSpinner.text = `Checking mail records for ${company.domain}...`;
      const hasMail = await hasMailServer(company.domain);
      if (hasMail) {
        activeCompanies.push(company);
      } else {
        dnsSpinner.stop();
        log.warn(`Skipping ${company.domain}: No active MX (mail exchange) records found.`);
        dnsSpinner.start();
      }
    }
    dnsSpinner.succeed(`MX record validation complete. ${activeCompanies.length}/${companies.length} domains are active email targets.`);
    companies = activeCompanies;
  }

  if (companies.length === 0) {
    log.warn('No active company domains found. Exiting.');
    return;
  }

  // Stage 2 & 3: Find contacts and enrich
  const enrichedLeads = [];
  const linkedinInvites = [];
  const leadSpinner = ora('Finding and enriching contacts...').start();

  try {
    for (const company of companies) {
      leadSpinner.text = `Fetching contacts for ${company.name} (${company.domain})...`;
      
      let contacts = [];
      try {
        contacts = await fetchContactsWithFallback(company.domain, contactLimit, seniorities, titles, isMock, company.name);
      } catch (searchErr) {
        leadSpinner.stop();
        log.warn(`Skipping contact search for ${company.name} (${company.domain}): ${searchErr.message}`);
        leadSpinner.start();
        continue;
      }

      for (const contact of contacts) {
        leadSpinner.text = `Enriching contact ${contact.firstName} ${contact.lastName} (${company.name})...`;
        
        let enriched = null;
        if (contact.email) {
          // Already has email (e.g. resolved from Hunter.io)
          enriched = contact;
        } else {
          try {
            if (isMock) {
              enriched = await mockEnrichContact(contact);
            } else {
              enriched = await enrichContact(contact);
              await sleep(1500); // 1.5s delay to avoid Prospeo rate limits (1 req/sec)
            }
          } catch (enrichErr) {
            leadSpinner.stop();
            log.warn(`Skipping email enrichment for ${contact.firstName} ${contact.lastName}: ${enrichErr.message}`);
            leadSpinner.start();
          }
        }

        if (enriched && enriched.email) {
          // Strict verification filtering
          if (isStrict && (enriched.emailStatus || '').toLowerCase() !== 'verified') {
            leadSpinner.stop();
            log.warn(`Skipping risky email for ${contact.firstName} ${contact.lastName} in Strict Mode (${enriched.emailStatus}).`);
            
            // Backup to LinkedIn Invite
            const inviteNote = `Hi ${contact.firstName || ''}, I noticed you lead the team at ${company.name || ''} as ${contact.title || 'team lead'}. I'm an aspiring developer looking to contribute. Here is my GitHub: github.com/Benhur167. Let's connect!`.substring(0, 299);
            linkedinInvites.push({
              name: `${contact.firstName} ${contact.lastName}`,
              profile: contact.linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.firstName + ' ' + contact.lastName + ' ' + company.name)}`,
              inviteNote
            });
            
            leadSpinner.start();
            continue;
          }

          enrichedLeads.push({
            ...contact,
            email: enriched.email,
            emailStatus: enriched.emailStatus,
            linkedinUrl: enriched.linkedinUrl
          });
        } else {
          // No email found - add as LinkedIn Invite backup
          const inviteNote = `Hi ${contact.firstName || ''}, I noticed you lead the team at ${company.name || ''} as ${contact.title || 'team lead'}. I'm an aspiring developer looking to contribute. Here is my GitHub: github.com/Benhur167. Let's connect!`.substring(0, 299);
          linkedinInvites.push({
            name: `${contact.firstName} ${contact.lastName}`,
            profile: contact.linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.firstName + ' ' + contact.lastName + ' ' + company.name)}`,
            inviteNote
          });
        }
      }
    }
    leadSpinner.succeed(`Successfully enriched ${enrichedLeads.length} leads.`);
  } catch (err) {
    leadSpinner.fail(`Lead enrichment failed: ${err.message}`);
    process.exit(1);
  }

  // Load sender personalization variables from environment
  const senderDetails = {
    senderName: process.env.BREVO_SENDER_NAME || 'Your Name',
    senderGithub: process.env.SENDER_GITHUB || '',
    senderPortfolio: process.env.SENDER_PORTFOLIO || '',
    senderResumeLink: options.resumeUrl || process.env.SENDER_RESUME_LINK || ''
  };

  // Load subject/template from environment
  const subjectTemplate = process.env.OUTREACH_SUBJECT || 'Quick question regarding <COMPANY_NAME>';
  const bodyTemplate = process.env.OUTREACH_TEMPLATE || 'Hi <FIRST_NAME>,\n\nI noticed you are leading the team at <COMPANY_NAME> as <TITLE>. I\'d love to connect.\n\nBest,\n<SENDER_NAME>';

  // Output/Send Phase
  if (autoSend && enrichedLeads.length > 0) {
    const emailSpinner = ora(`Sending ${enrichedLeads.length} outreach emails...`).start();
    let sentCount = 0;
    try {
      for (const lead of enrichedLeads) {
        const subject = compileTemplate(subjectTemplate, { ...lead, ...senderDetails });
        const bodyText = compileTemplate(bodyTemplate, { ...lead, ...senderDetails });

        const emailPayload = {
          toEmail: lead.email,
          toName: `${lead.firstName} ${lead.lastName}`,
          subject,
          bodyText
        };
        if (attachment) {
          emailPayload.attachment = attachment;
        }

        if (isMock) {
          emailSpinner.stop();
          await mockSendEmail(
            emailPayload,
            process.env.BREVO_SENDER_EMAIL || 'you@yourdomain.com',
            process.env.BREVO_SENDER_NAME || 'Your Name'
          );
          emailSpinner.start(`Sending outreach emails...`);
          sentCount++;
        } else {
          // Smart random throttle delay (3000ms - 6000ms)
          const delay = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;
          emailSpinner.text = `Waiting ${Math.round(delay/1000)}s (SMTP throttle)...`;
          await sleep(delay);

          emailSpinner.text = `Sending email to ${lead.email}...`;
          const success = await sendColdEmail(emailPayload);
          if (success) sentCount++;
        }
      }
      emailSpinner.succeed(`Successfully sent ${sentCount} outreach emails.`);
    } catch (err) {
      emailSpinner.fail(`Failed to send emails: ${err.message}`);
      process.exit(1);
    }
  } else if (enrichedLeads.length > 0) {
    // Output results to JSON since --send was not passed
    const outputPath = path.join(process.cwd(), 'outreach_leads.json');
    fs.writeFileSync(outputPath, JSON.stringify(enrichedLeads, null, 2));
    log.success(`Leads exported to ${outputPath}`);
    console.table(enrichedLeads.map(l => ({
      Name: `${l.firstName} ${l.lastName}`,
      Title: l.title,
      Email: l.email,
      Status: l.emailStatus,
      Company: l.companyName || l.domain,
      LinkedIn: l.linkedinUrl
    })));
  } else {
    log.warn('No contact emails found to send or export.');
  }

  // Display LinkedIn invites if any leads failed email enrichment
  if (linkedinInvites.length > 0) {
    printHeader('LinkedIn Connection Invites (Email unavailable/risky)');
    console.table(linkedinInvites.map(i => ({
      Name: i.name,
      Profile: i.profile,
      'Invite Note (<300 chars)': i.inviteNote
    })));
  }
}
/**
 * Sends a real test email to check Brevo SMTP key, sender setup, and portfolio formatting.
 */
async function runSmtpTest() {
  printHeader('Brevo SMTP Verification Test');
  
  const defaultRecipient = process.env.BREVO_SENDER_EMAIL || '';
  if (!defaultRecipient) {
    log.error('BREVO_SENDER_EMAIL is not set in your .env file. Please set it before testing.');
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'recipient',
      message: 'Enter test recipient email address:',
      default: defaultRecipient,
      validate: (input) => isValidEmail(input.trim()) ? true : 'Invalid email address'
    },
    {
      type: 'confirm',
      name: 'attachResume',
      message: 'Do you want to test sending the resume attachment too?',
      default: false
    }
  ]);

  let attachment = null;
  if (answers.attachResume) {
    if (process.env.SENDER_RESUME_LINK && process.env.SENDER_RESUME_LINK.startsWith('http')) {
      const fetchSpinner = ora('Downloading and converting resume PDF...').start();
      try {
        attachment = await resolveUrlAttachment(process.env.SENDER_RESUME_LINK, 'resume.pdf');
        fetchSpinner.succeed('Successfully downloaded and resolved resume to Base64.');
      } catch (err) {
        fetchSpinner.fail(`Failed to load remote resume: ${err.message}`);
        log.warn('Proceeding to send test email without attachment.');
      }
    } else {
      log.warn('No valid SENDER_RESUME_LINK found in .env. Sending without attachment.');
    }
  }

  const senderDetails = {
    senderName: process.env.BREVO_SENDER_NAME || 'Benhur',
    senderGithub: process.env.SENDER_GITHUB || 'https://github.com/Benhur167',
    senderPortfolio: process.env.SENDER_PORTFOLIO || 'https://portfolio-three-nu-ahd12rnfpa.vercel.app',
    senderResumeLink: process.env.SENDER_RESUME_LINK || ''
  };

  const subject = `Cold Outreach SMTP Test - Working Opportunity Pipeline`;
  const bodyText = `Hi there,\n\nThis is a real-time verification email sent via your Cold Outreach Pipeline CLI.\n\nYour SMTP settings are working perfectly!\n\nHere is a check of your personal profile placeholders:\n- GitHub: ${senderDetails.senderGithub}\n- Portfolio: ${senderDetails.senderPortfolio}\n- Resume Link: ${senderDetails.senderResumeLink || 'Not configured'}\n\nBest,\n${senderDetails.senderName}`;

  const spinner = ora(`Sending test email to ${answers.recipient}...`).start();
  try {
    const emailPayload = {
      toEmail: answers.recipient,
      toName: senderDetails.senderName,
      subject,
      bodyText
    };
    if (attachment) {
      emailPayload.attachment = attachment;
    }

    const success = await sendColdEmail(emailPayload);
    if (success) {
      spinner.succeed(`Success! Test email sent successfully to ${answers.recipient}. Please check your inbox/spam folder.`);
    } else {
      spinner.fail('Brevo API returned a non-success code.');
    }
  } catch (err) {
    spinner.fail(`SMTP Verification failed: ${err.message}`);
  }
}

/**
 * Runs the interactive terminal UI wizard.
 */
async function runInteractivePipeline() {
  // 1. Choose Execution Mode
  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'Select pipeline execution mode:',
      choices: [
        { name: 'Mock Mode (Simulation, no API keys needed)', value: 'mock' },
        { name: 'Production Mode (Uses real API credentials from .env)', value: 'production' },
        { name: 'Verify Brevo SMTP Setup (Send a real test email to yourself)', value: 'test_smtp' }
      ]
    }
  ]);

  if (mode === 'test_smtp') {
    await runSmtpTest();
    return;
  }

  const isMock = mode === 'mock';

  // 2. Select Search Provider
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Choose company discovery provider:',
      choices: [
        { name: 'Active Job Listings Search (The Muse & Arbeitnow APIs - Recommended)', value: 'jobs' },
        { name: 'Apollo.io (Recommended free alternative)', value: 'apollo' },
        { name: 'Ocean.io (Standard lookup)', value: 'ocean' },
        { name: 'Manual Input (Enter domains manually)', value: 'manual' }
      ]
    }
  ]);

  let companies = [];

  if (provider === 'manual') {
    const { domainsString } = await inquirer.prompt([
      {
        type: 'input',
        name: 'domainsString',
        message: 'Enter website domains separated by commas (e.g., stripe.com, airbnb.com):',
        validate: (input) => {
          if (!input.trim()) return 'Domain list cannot be empty';
          const list = input.split(',').map(d => cleanDomain(d));
          const invalid = list.filter(d => !isValidDomain(d));
          if (invalid.length > 0) return `Invalid domains found: ${invalid.join(', ')}`;
          return true;
        }
      }
    ]);

    companies = domainsString.split(',').map(d => {
      const cleaned = cleanDomain(d);
      return { name: cleaned.split('.')[0].charAt(0).toUpperCase() + cleaned.split('.')[0].slice(1), domain: cleaned };
    });
  } else if (provider === 'jobs') {
    const { category, level, location, limit } = await inquirer.prompt([
      {
        type: 'list',
        name: 'category',
        message: 'Select job category to search:',
        choices: [
          'Software Engineering',
          'Computer and IT',
          'Design and UX',
          'Data Science'
        ],
        default: 'Software Engineering'
      },
      {
        type: 'list',
        name: 'level',
        message: 'Select target seniority level:',
        choices: [
          'Internship',
          'Entry Level',
          'Mid Level',
          'Senior Level'
        ],
        default: 'Internship'
      },
      {
        type: 'input',
        name: 'location',
        message: 'Enter target location (e.g., "India", "Remote", or leave empty for all):',
        default: ''
      },
      {
        type: 'number',
        name: 'limit',
        message: 'Max hiring companies to discover:',
        default: 3
      }
    ]);

    const spinner = ora(`Searching active listings for "${category}" at "${level}" level${location ? ` in "${location}"` : ''}...`).start();
    try {
      const discovered = await discoverHiringCompanies(category, level, location, limit, isMock);
      spinner.succeed(`Discovered ${discovered.length} hiring companies.`);
      
      const resolveSpinner = ora('Resolving company domains...').start();
      for (const item of discovered) {
        resolveSpinner.text = `Resolving domain for ${item.name}...`;
        const domain = await resolveCompanyDomain(item.name, isMock);
        if (domain) {
          companies.push({ name: item.name, domain });
        }
      }
      resolveSpinner.succeed(`Domain resolution complete. Resolved ${companies.length} companies.`);
    } catch (err) {
      spinner.fail(`Job discovery failed: ${err.message}`);
      return;
    }
  } else {
    // Ocean/Apollo keyword search
    const { query, limit } = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: `Enter search keyword/industry for ${provider.toUpperCase()}:`,
        default: 'artificial intelligence'
      },
      {
        type: 'number',
        name: 'limit',
        message: 'Max companies to fetch:',
        default: 3
      }
    ]);

    const spinner = ora(`Searching companies using ${provider.toUpperCase()}...`).start();
    try {
      if (isMock) {
        companies = await mockSearchCompanies(query, limit, provider);
      } else if (provider === 'ocean') {
        companies = await oceanSearch(query, limit);
      } else {
        companies = await apolloSearch(query, limit);
      }
      spinner.succeed(`Discovery phase complete. Found ${companies.length} companies.`);
    } catch (err) {
      spinner.fail(`Company search failed: ${err.message}`);
      return;
    }
  }

  // Review Discovered Companies
  printHeader('Discovered Companies');
  companies.forEach((c, idx) => console.log(`${idx + 1}. ${chalk.bold(c.name)} (${chalk.cyan(c.domain)})`));

  // Offline MX Record Validation (Skip in Mock Mode)
  if (companies.length > 0 && !isMock) {
    await sleep(350); // Let stream settle
    const { verifyMX } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'verifyMX',
        message: 'Verify company domain MX records offline first to ensure their email servers are active?',
        default: true
      }
    ]);

    if (verifyMX) {
      const dnsSpinner = ora('Verifying company domain mail servers (MX records)...').start();
      const activeCompanies = [];
      for (const company of companies) {
        dnsSpinner.text = `Checking mail records for ${company.domain}...`;
        const hasMail = await hasMailServer(company.domain);
        if (hasMail) {
          activeCompanies.push(company);
        } else {
          dnsSpinner.stop();
          log.warn(`Skipping ${company.domain}: No active MX (mail exchange) records found.`);
          dnsSpinner.start();
        }
      }
      dnsSpinner.succeed(`MX record validation complete. ${activeCompanies.length}/${companies.length} domains are active email targets.`);
      companies = activeCompanies;
    }
  }

  if (companies.length === 0) {
    log.warn('No active company domains found. Exiting.');
    return;
  }

  await sleep(350); // Let stream settle
  const { proceedToEnrich } = await inquirer.prompt([
    {
      type: 'confirm',
      message: 'Do you want to proceed with finding decision makers and their emails using Prospeo?',
      name: 'proceedToEnrich',
      default: true
    }
  ]);

  if (!proceedToEnrich) {
    log.info('Outreach canceled. Exiting.');
    return;
  }

  // Target preset prompt
  const { targetPresetKey } = await inquirer.prompt([
    {
      type: 'list',
      name: 'targetPresetKey',
      message: 'Choose who you want to target at these companies:',
      choices: Object.entries(TARGET_PRESETS).map(([key, value]) => ({
        name: value.name,
        value: key
      }))
    }
  ]);

  let seniorities = [];
  let titles = [];

  if (targetPresetKey === 'custom') {
    const customAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'senioritiesString',
        message: 'Enter comma-separated seniorities (e.g. Founder/Owner, C-Suite, Manager, All):',
        default: 'All'
      },
      {
        type: 'input',
        name: 'titlesString',
        message: 'Enter comma-separated job titles to include (e.g. CTO, Software Engineer, All):',
        default: 'All'
      }
    ]);
    seniorities = customAnswers.senioritiesString.split(',').map(s => s.trim());
    titles = customAnswers.titlesString.split(',').map(t => t.trim());
  } else {
    seniorities = TARGET_PRESETS[targetPresetKey].seniorities;
    titles = TARGET_PRESETS[targetPresetKey].titles;
  }

  // Enforce Strict Verification Prompt
  const { enforceStrict } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enforceStrict',
      message: 'Enforce Strict Verification? (Discard "catch_all"/risky emails to guarantee 0% bounce rate)',
      default: false
    }
  ]);

  // Resume attachment prompt
  const { resumeOption } = await inquirer.prompt([
    {
      type: 'list',
      name: 'resumeOption',
      message: 'Do you want to send a resume/portfolio with your outreach?',
      choices: [
        { name: 'No, I\'ll include a portfolio/resume link in my email body (Recommended for deliverability)', value: 'none' },
        { name: 'Yes, attach a local PDF file', value: 'local' },
        { name: 'Yes, attach a PDF from a public URL', value: 'url' }
      ]
    }
  ]);

  let attachment = null;
  let senderResumeLink = '';

  if (resumeOption === 'local') {
    const { localPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'localPath',
        message: 'Enter the absolute path to your local PDF resume:',
        validate: (input) => {
          if (!input.trim()) return 'Path cannot be empty';
          if (!fs.existsSync(path.resolve(input.trim()))) return 'File does not exist. Please enter a valid path.';
          if (!input.trim().toLowerCase().endsWith('.pdf')) return 'Must be a PDF file';
          return true;
        }
      }
    ]);
    try {
      const resolvedPath = path.resolve(localPath.trim());
      const fileContent = fs.readFileSync(resolvedPath).toString('base64');
      attachment = {
        content: fileContent,
        name: path.basename(resolvedPath)
      };
      log.success(`Loaded local resume: ${path.basename(resolvedPath)}`);
    } catch (err) {
      log.error(`Failed to read resume file: ${err.message}`);
    }
  } else if (resumeOption === 'url') {
    const { pdfUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'pdfUrl',
        message: 'Enter the public URL to your PDF resume (e.g. Google Drive/Dropbox public link):',
        validate: (input) => {
          if (!input.trim()) return 'URL cannot be empty';
          if (!input.trim().startsWith('http')) return 'Invalid URL';
          return true;
        }
      }
    ]);
    const fetchSpinner = ora('Downloading and converting remote PDF resume...').start();
    try {
      attachment = await resolveUrlAttachment(pdfUrl.trim(), 'resume.pdf');
      fetchSpinner.succeed('Successfully downloaded and resolved remote resume to Base64.');
    } catch (err) {
      fetchSpinner.fail(`Failed to load remote resume: ${err.message}`);
      log.warn('Proceeding without email attachment (it will still be linked in the text).');
    }
    senderResumeLink = pdfUrl.trim();
  }

  // Sender personal details prompt
  printHeader('Your Personal Details');
  const personalAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'senderName',
      message: 'Your Name:',
      default: process.env.BREVO_SENDER_NAME || 'Benhur'
    },
    {
      type: 'input',
      name: 'senderGithub',
      message: 'Your GitHub URL:',
      default: process.env.SENDER_GITHUB || 'https://github.com/Benhur167'
    },
    {
      type: 'input',
      name: 'senderPortfolio',
      message: 'Your Portfolio URL / LinkedIn Profile (Optional):',
      default: process.env.SENDER_PORTFOLIO || ''
    },
    {
      type: 'input',
      name: 'inlineResumeLink',
      message: 'Your public Resume PDF Link (Used for inline templates. Optional):',
      default: senderResumeLink || process.env.SENDER_RESUME_LINK || ''
    }
  ]);

  const senderDetails = {
    senderName: personalAnswers.senderName,
    senderGithub: personalAnswers.senderGithub,
    senderPortfolio: personalAnswers.senderPortfolio,
    senderResumeLink: personalAnswers.inlineResumeLink
  };

  const { contactLimit } = await inquirer.prompt([
    {
      type: 'number',
      name: 'contactLimit',
      message: 'Max contacts to fetch per company:',
      default: 1
    }
  ]);

  // Stage 2 & 3: Find contacts and enrich emails
  const enrichedLeads = [];
  const linkedinInvites = [];
  const leadSpinner = ora('Starting contact discovery & enrichment...').start();

  try {
    for (const company of companies) {
      leadSpinner.text = `Searching contacts at ${company.domain}...`;
      
      let contacts = [];
      try {
        contacts = await fetchContactsWithFallback(company.domain, contactLimit, seniorities, titles, isMock, company.name);
      } catch (searchErr) {
        leadSpinner.stop();
        log.warn(`Skipping contact search for ${company.domain}: ${searchErr.message}`);
        leadSpinner.start();
        continue;
      }

      for (const contact of contacts) {
        leadSpinner.text = `Enriching email for ${contact.firstName} ${contact.lastName}...`;
        
        let enriched = null;
        if (contact.email) {
          // Already has email (e.g. resolved from Hunter.io)
          enriched = contact;
        } else {
          try {
            if (isMock) {
              enriched = await mockEnrichContact(contact);
            } else {
              enriched = await enrichContact(contact);
              await sleep(1500); // 1.5s delay to avoid Prospeo rate limits (1 req/sec)
            }
          } catch (enrichErr) {
            leadSpinner.stop();
            log.warn(`Skipping email enrichment for ${contact.firstName} ${contact.lastName}: ${enrichErr.message}`);
            leadSpinner.start();
          }
        }

        if (enriched && enriched.email) {
          // Strict verification filtering
          if (enforceStrict && (enriched.emailStatus || '').toLowerCase() !== 'verified') {
            leadSpinner.stop();
            log.warn(`Skipping risky email for ${contact.firstName} ${contact.lastName} in Strict Mode (${enriched.emailStatus}).`);
            
            // Backup to LinkedIn Invite
            const inviteNote = `Hi ${contact.firstName || ''}, I noticed you lead the team at ${company.name || ''} as ${contact.title || 'team lead'}. I'm an aspiring developer looking to contribute. Here is my GitHub: github.com/Benhur167. Let's connect!`.substring(0, 299);
            linkedinInvites.push({
              name: `${contact.firstName} ${contact.lastName}`,
              profile: contact.linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.firstName + ' ' + contact.lastName + ' ' + company.name)}`,
              inviteNote
            });
            
            leadSpinner.start();
            continue;
          }

          enrichedLeads.push({
            ...contact,
            email: enriched.email,
            emailStatus: enriched.emailStatus,
            linkedinUrl: enriched.linkedinUrl
          });
        } else {
          // No email found - add as LinkedIn Invite backup
          const inviteNote = `Hi ${contact.firstName || ''}, I noticed you lead the team at ${company.name || ''} as ${contact.title || 'team lead'}. I'm an aspiring developer looking to contribute. Here is my GitHub: github.com/Benhur167. Let's connect!`.substring(0, 299);
          linkedinInvites.push({
            name: `${contact.firstName} ${contact.lastName}`,
            profile: contact.linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.firstName + ' ' + contact.lastName + ' ' + company.name)}`,
            inviteNote
          });
        }
      }
    }
    leadSpinner.succeed(`Enrichment complete. Found ${enrichedLeads.length} contact emails.`);
  } catch (err) {
    leadSpinner.fail(`Enrichment failed: ${err.message}`);
    return;
  }

  // Display Table of Leads if any found
  if (enrichedLeads.length > 0) {
    printHeader('Enriched Leads');
    console.table(enrichedLeads.map(l => ({
      Name: `${l.firstName} ${l.lastName}`,
      Title: l.title,
      Email: l.email,
      Status: l.emailStatus,
      Company: l.companyName || l.domain,
      LinkedIn: l.linkedinUrl
    })));
  } else {
    log.warn('No verified contact emails found.');
  }

  // 4. Configure / Confirm Email Template
  printHeader('Outreach Template Configuration');

  await sleep(350); // Let stream settle
  // Select from template library
  const { chosenTemplateIndex } = await inquirer.prompt([
    {
      type: 'list',
      name: 'chosenTemplateIndex',
      message: 'Select an outreach email template to customize:',
      choices: [
        ...TEMPLATE_LIBRARY.map((t, idx) => ({ name: t.name, value: idx })),
        { name: 'Custom Template (Write your own in terminal)', value: -1 }
      ]
    }
  ]);

  let subjectTemplate = '';
  let bodyTemplate = '';

  if (chosenTemplateIndex === -1) {
    const customTemplate = await inquirer.prompt([
      {
        type: 'input',
        name: 'subject',
        message: 'Outreach Subject Template (supports <COMPANY_NAME>):',
        default: 'Quick question regarding <COMPANY_NAME>'
      },
      {
        type: 'editor',
        name: 'body',
        message: 'Outreach Body Template (supports <FIRST_NAME>, <LAST_NAME>, <COMPANY_NAME>, <TITLE>, <SENDER_NAME>, <SENDER_GITHUB>, <SENDER_PORTFOLIO>, <SENDER_RESUME_LINK>):',
        default: 'Hi <FIRST_NAME>,\n\nI noticed you are leading the team at <COMPANY_NAME> as <TITLE>. I\'d love to connect.\n\nBest,\n<SENDER_NAME>'
      }
    ]);
    subjectTemplate = customTemplate.subject;
    bodyTemplate = customTemplate.body;
  } else {
    const selTemplate = TEMPLATE_LIBRARY[chosenTemplateIndex];
    subjectTemplate = selTemplate.subject;
    bodyTemplate = selTemplate.body;

    await sleep(350); // Let stream settle
    const { editTemplate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'editTemplate',
        message: 'Do you want to review and edit the selected template text?',
        default: false
      }
    ]);

    if (editTemplate) {
      const edited = await inquirer.prompt([
        {
          type: 'input',
          name: 'subject',
          message: 'Subject Template:',
          default: subjectTemplate
        },
        {
          type: 'editor',
          name: 'body',
          message: 'Body Template:',
          default: bodyTemplate
        }
      ]);
      subjectTemplate = edited.subject;
      bodyTemplate = edited.body;
    }
  }

  // Preview first compiled email if we have any leads
  if (enrichedLeads.length > 0) {
    printHeader('Preview First Email');
    const sampleLead = enrichedLeads[0];
    console.log(chalk.bold('Subject: ') + compileTemplate(subjectTemplate, { ...sampleLead, ...senderDetails }));
    console.log(chalk.bold('Body:\n') + compileTemplate(bodyTemplate, { ...sampleLead, ...senderDetails }));
    console.log(chalk.cyan('===================================================='));
  }

  // 5. Send Cold Email outreach
  let sendOutreach = false;
  if (enrichedLeads.length > 0) {
    await sleep(350); // Let stdin buffer settle on Windows
    const confirmSend = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'sendOutreach',
        message: `Do you want to send cold email outreach to these ${enrichedLeads.length} contacts now?`,
        default: false
      }
    ]);
    sendOutreach = confirmSend.sendOutreach;
  }

  if (sendOutreach && enrichedLeads.length > 0) {
    const emailSpinner = ora('Initiating outbound email queue...').start();
    let sentCount = 0;
    try {
      for (const lead of enrichedLeads) {
        const subject = compileTemplate(subjectTemplate, { ...lead, ...senderDetails });
        const bodyText = compileTemplate(bodyTemplate, { ...lead, ...senderDetails });

        const emailPayload = {
          toEmail: lead.email,
          toName: `${lead.firstName} ${lead.lastName}`,
          subject,
          bodyText
        };
        if (attachment) {
          emailPayload.attachment = attachment;
        }

        if (isMock) {
          emailSpinner.stop();
          await mockSendEmail(
            emailPayload,
            process.env.BREVO_SENDER_EMAIL || 'you@yourdomain.com',
            process.env.BREVO_SENDER_NAME || 'Your Name'
          );
          emailSpinner.start('Sending outreach emails...');
          sentCount++;
        } else {
          // Smart randomized SMTP throttle delay (3000ms - 6000ms)
          const delay = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;
          emailSpinner.text = `Waiting ${Math.round(delay/1000)}s (SMTP throttle)...`;
          await sleep(delay);

          emailSpinner.text = `Sending email to ${lead.email}...`;
          const success = await sendColdEmail(emailPayload);
          if (success) sentCount++;
        }
      }
      emailSpinner.succeed(`Outreach Campaign completed. Successfully sent ${sentCount} cold emails.`);
    } catch (err) {
      emailSpinner.fail(`Failed during mailing stage: ${err.message}`);
    }
  } else if (enrichedLeads.length > 0) {
    // If they choose not to send, export to json file
    const outputPath = path.join(process.cwd(), 'outreach_leads.json');
    fs.writeFileSync(outputPath, JSON.stringify(enrichedLeads, null, 2));
    log.success(`Leads database exported to: ${outputPath}`);
    log.info('You can review or import this database into your outbound mailing tools later.');
  }

  // Display LinkedIn Invite table for contacts without emails / risky emails
  if (linkedinInvites.length > 0) {
    printHeader('LinkedIn Connection Invites (Email unavailable/risky)');
    console.table(linkedinInvites.map(i => ({
      Name: i.name,
      Profile: i.profile,
      'Invite Note (<300 chars)': i.inviteNote
    })));
    log.info('Copy these invite notes and connect with them directly on LinkedIn to secure responses!');
  }
}

main().catch(err => {
  log.error(`Fatal crash: ${err.message}`);
  process.exit(1);
});

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import {
  log,
  printBanner,
  printHeader,
  sleep,
  cleanDomain,
  isValidDomain
} from './utils.js';

// Real API imports
import { searchCompanies as oceanSearch } from './ocean.js';
import { searchCompanies as apolloSearch } from './apollo.js';
import { findContactsForDomain, enrichContact } from './prospeo.js';
import { sendColdEmail, compileTemplate } from './brevo.js';

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
  .option('-p, --provider <provider>', 'Company search provider (ocean, apollo, or manual)')
  .option('-q, --query <query>', 'Keyword/search term for finding companies')
  .option('-d, --domain <domain>', 'Process outreach for a single target domain directly')
  .option('-l, --limit <number>', 'Maximum number of companies to fetch', parseInt, 5)
  .option('-c, --contact-limit <number>', 'Maximum contacts to enrich per company', parseInt, 2)
  .option('-s, --send', 'Send emails automatically without prompting');

program.parse(process.argv);
const options = program.opts();

// Check if any arguments were provided to skip interactive mode
const hasCliArguments = options.provider || options.query || options.domain || options.mock || program.args.length > 0;

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

  log.info(`Running pipeline in ${isMock ? 'MOCK' : 'PRODUCTION'} mode...`);

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

  if (companies.length === 0) {
    log.warn('No companies found. Exiting.');
    return;
  }

  // Stage 2 & 3: Find contacts and enrich
  const enrichedLeads = [];
  const leadSpinner = ora('Finding and enriching C-level/VP contacts...').start();

  try {
    for (const company of companies) {
      leadSpinner.text = `Fetching contacts for ${company.name} (${company.domain})...`;
      
      let contacts = [];
      if (isMock) {
        contacts = await mockFindContacts(company.domain, contactLimit);
      } else {
        contacts = await findContactsForDomain(company.domain, contactLimit);
      }

      for (const contact of contacts) {
        leadSpinner.text = `Enriching contact ${contact.firstName} ${contact.lastName} (${company.name})...`;
        
        let enriched = null;
        if (isMock) {
          enriched = await mockEnrichContact(contact);
        } else {
          enriched = await enrichContact(contact);
          await sleep(1500); // 1.5s delay to avoid Prospeo rate limits (1 req/sec)
        }

        if (enriched && enriched.email) {
          enrichedLeads.push({
            ...contact,
            email: enriched.email,
            emailStatus: enriched.emailStatus,
            linkedinUrl: enriched.linkedinUrl
          });
        }
      }
    }
    leadSpinner.succeed(`Successfully enriched ${enrichedLeads.length} leads.`);
  } catch (err) {
    leadSpinner.fail(`Lead enrichment failed: ${err.message}`);
    process.exit(1);
  }

  if (enrichedLeads.length === 0) {
    log.warn('No contact emails found. Exiting.');
    return;
  }

  // Load subject/template from environment
  const subjectTemplate = process.env.OUTREACH_SUBJECT || 'Quick question regarding <COMPANY_NAME>';
  const bodyTemplate = process.env.OUTREACH_TEMPLATE || 'Hi <FIRST_NAME>,\n\nI noticed you are leading the team at <COMPANY_NAME> as <TITLE>. I\'d love to connect.\n\nBest,\nYour Name';

  // Output/Send Phase
  if (autoSend) {
    const emailSpinner = ora(`Sending ${enrichedLeads.length} outreach emails...`).start();
    let sentCount = 0;
    try {
      for (const lead of enrichedLeads) {
        const subject = compileTemplate(subjectTemplate, lead);
        const bodyText = compileTemplate(bodyTemplate, lead);

        if (isMock) {
          emailSpinner.stop();
          await mockSendEmail(
            { toEmail: lead.email, toName: `${lead.firstName} ${lead.lastName}`, subject, bodyText },
            process.env.BREVO_SENDER_EMAIL || 'you@yourdomain.com',
            process.env.BREVO_SENDER_NAME || 'Your Name'
          );
          emailSpinner.start(`Sending outreach emails...`);
          sentCount++;
        } else {
          const success = await sendColdEmail({
            toEmail: lead.email,
            toName: `${lead.firstName} ${lead.lastName}`,
            subject,
            bodyText
          });
          if (success) sentCount++;
          // Rate-limit sleep (e.g. 1s between real emails)
          await sleep(1000);
        }
      }
      emailSpinner.succeed(`Successfully sent ${sentCount} outreach emails.`);
    } catch (err) {
      emailSpinner.fail(`Failed to send emails: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Output results to JSON since --send was not passed
    const outputPath = path.join(process.cwd(), 'outreach_leads.json');
    fs.writeFileSync(outputPath, JSON.stringify(enrichedLeads, null, 2));
    log.success(`Leads exported to ${outputPath}`);
    console.table(enrichedLeads.map(l => ({
      Name: `${l.firstName} ${l.lastName}`,
      Title: l.title,
      Email: l.email,
      Company: l.companyName || l.domain,
      LinkedIn: l.linkedinUrl
    })));
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
        { name: 'Production Mode (Uses real API credentials from .env)', value: 'production' }
      ]
    }
  ]);

  const isMock = mode === 'mock';

  // 2. Select Search Provider
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Choose company discovery provider:',
      choices: [
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

  if (companies.length === 0) {
    log.warn('No companies discovered. Exiting.');
    return;
  }

  // Review Discovered Companies
  printHeader('Discovered Companies');
  companies.forEach((c, idx) => console.log(`${idx + 1}. ${chalk.bold(c.name)} (${chalk.cyan(c.domain)})`));

  const { proceedToEnrich } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceedToEnrich',
      message: 'Do you want to proceed with finding decision makers (C-Level/VP) and their emails using Prospeo?',
      default: true
    }
  ]);

  if (!proceedToEnrich) {
    log.info('Outreach canceled. Exiting.');
    return;
  }

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
  const leadSpinner = ora('Starting contact discovery & enrichment...').start();

  try {
    for (const company of companies) {
      leadSpinner.text = `Searching contacts at ${company.domain}...`;
      
      let contacts = [];
      if (isMock) {
        contacts = await mockFindContacts(company.domain, contactLimit);
      } else {
        contacts = await findContactsForDomain(company.domain, contactLimit);
      }

      for (const contact of contacts) {
        leadSpinner.text = `Enriching email for ${contact.firstName} ${contact.lastName}...`;
        
        let enriched = null;
        if (isMock) {
          enriched = await mockEnrichContact(contact);
        } else {
          enriched = await enrichContact(contact);
          await sleep(1500); // 1.5s delay to avoid Prospeo rate limits (1 req/sec)
        }

        if (enriched && enriched.email) {
          enrichedLeads.push({
            ...contact,
            email: enriched.email,
            emailStatus: enriched.emailStatus,
            linkedinUrl: enriched.linkedinUrl
          });
        }
      }
    }
    leadSpinner.succeed(`Enrichment complete. Found ${enrichedLeads.length} contact emails.`);
  } catch (err) {
    leadSpinner.fail(`Enrichment failed: ${err.message}`);
    return;
  }

  if (enrichedLeads.length === 0) {
    log.warn('No contact emails found. Exiting.');
    return;
  }

  // Display Table of Leads
  printHeader('Enriched Leads');
  console.table(enrichedLeads.map(l => ({
    Name: `${l.firstName} ${l.lastName}`,
    Title: l.title,
    Email: l.email,
    Company: l.companyName || l.domain,
    LinkedIn: l.linkedinUrl
  })));

  // 4. Configure / Confirm Email Template
  printHeader('Outreach Template Configuration');
  const defaultSubject = process.env.OUTREACH_SUBJECT || 'Quick question regarding <COMPANY_NAME>';
  const defaultBody = process.env.OUTREACH_TEMPLATE || 'Hi <FIRST_NAME>,\n\nI noticed you are leading the team at <COMPANY_NAME> as <TITLE>. I\'d love to connect.\n\nBest,\nYour Name';

  await sleep(350); // Let stdin buffer settle on Windows
  const { editTemplate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'editTemplate',
      message: 'Do you want to review and edit the outreach email template?',
      default: false
    }
  ]);

  let subjectTemplate = defaultSubject;
  let bodyTemplate = defaultBody;

  if (editTemplate) {
    const templateAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'subject',
        message: 'Outreach Subject Template (supports <COMPANY_NAME>):',
        default: defaultSubject
      },
      {
        type: 'editor',
        name: 'body',
        message: 'Outreach Body Template (supports <FIRST_NAME>, <LAST_NAME>, <COMPANY_NAME>, <TITLE>):',
        default: defaultBody
      }
    ]);
    subjectTemplate = templateAnswers.subject;
    bodyTemplate = templateAnswers.body;
  }

  // Preview the first compiled email
  printHeader('Preview First Email');
  const sampleLead = enrichedLeads[0];
  console.log(chalk.bold('Subject: ') + compileTemplate(subjectTemplate, sampleLead));
  console.log(chalk.bold('Body:\n') + compileTemplate(bodyTemplate, sampleLead));
  console.log(chalk.cyan('===================================================='));

  // 5. Send Cold Email outreach
  await sleep(350); // Let stdin buffer settle on Windows
  const { sendOutreach } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'sendOutreach',
      message: `Do you want to send cold email outreach to these ${enrichedLeads.length} contacts now?`,
      default: false
    }
  ]);

  if (sendOutreach) {
    const emailSpinner = ora('Initiating outbound email queue...').start();
    let sentCount = 0;
    try {
      for (const lead of enrichedLeads) {
        const subject = compileTemplate(subjectTemplate, lead);
        const bodyText = compileTemplate(bodyTemplate, lead);

        if (isMock) {
          emailSpinner.stop();
          await mockSendEmail(
            { toEmail: lead.email, toName: `${lead.firstName} ${lead.lastName}`, subject, bodyText },
            process.env.BREVO_SENDER_EMAIL || 'you@yourdomain.com',
            process.env.BREVO_SENDER_NAME || 'Your Name'
          );
          emailSpinner.start('Sending outreach emails...');
          sentCount++;
        } else {
          emailSpinner.text = `Sending email to ${lead.email}...`;
          const success = await sendColdEmail({
            toEmail: lead.email,
            toName: `${lead.firstName} ${lead.lastName}`,
            subject,
            bodyText
          });
          if (success) sentCount++;
          // Rate-limiting delay for real APIs
          await sleep(1000);
        }
      }
      emailSpinner.succeed(`Outreach Campaign completed. Successfully sent ${sentCount} cold emails.`);
    } catch (err) {
      emailSpinner.fail(`Failed during mailing stage: ${err.message}`);
    }
  } else {
    // If they choose not to send, export to json file
    const outputPath = path.join(process.cwd(), 'outreach_leads.json');
    fs.writeFileSync(outputPath, JSON.stringify(enrichedLeads, null, 2));
    log.success(`Leads database exported to: ${outputPath}`);
    log.info('You can review or import this database into your outbound mailing tools later.');
  }

  printHeader('Pipeline Session Finished');
  log.success('Thank you for using Cold Outreach Pipeline CLI!');
}

main().catch(err => {
  log.error(`Fatal crash: ${err.message}`);
  process.exit(1);
});

import axios from 'axios';
import { log } from './utils.js';

/**
 * Compiles a template string by replacing placeholders with contact/company values.
 * Placeholders: <FIRST_NAME>, <LAST_NAME>, <COMPANY_NAME>, <TITLE>
 * @param {string} template - The template string with placeholders
 * @param {Object} data - The values to replace placeholders with
 * @returns {string} Compiled string
 */
export function compileTemplate(template, data) {
  if (!template) return '';
  return template
    .replace(/<FIRST_NAME>/g, data.firstName || '')
    .replace(/<LAST_NAME>/g, data.lastName || '')
    .replace(/<COMPANY_NAME>/g, data.companyName || '')
    .replace(/<TITLE>/g, data.title || 'Decision Maker')
    .replace(/<SENDER_NAME>/g, data.senderName || process.env.BREVO_SENDER_NAME || 'Your Name')
    .replace(/<SENDER_GITHUB>/g, data.senderGithub || process.env.SENDER_GITHUB || '')
    .replace(/<SENDER_PORTFOLIO>/g, data.senderPortfolio || process.env.SENDER_PORTFOLIO || '')
    .replace(/<SENDER_RESUME_LINK>/g, data.senderResumeLink || process.env.SENDER_RESUME_LINK || '');
}

/**
 * Sends a transactional cold email via Brevo.
 * @param {Object} emailDetails - Details of the email to send
 * @param {string} emailDetails.toEmail - Recipient email
 * @param {string} emailDetails.toName - Recipient name
 * @param {string} emailDetails.subject - Compiled subject line
 * @param {string} emailDetails.bodyText - Compiled email body (supports markdown/newlines)
 * @param {Object} config - Config variables (apiKey, senderEmail, senderName)
 * @returns {Promise<boolean>} True if successful
 */
export async function sendColdEmail(emailDetails, config = {}) {
  const apiKey = config.apiKey || process.env.BREVO_API_KEY;
  const senderEmail = config.senderEmail || process.env.BREVO_SENDER_EMAIL;
  const senderName = config.senderName || process.env.BREVO_SENDER_NAME || 'Your Name';
  const url = 'https://api.brevo.com/v3/smtp/email';

  if (!apiKey || apiKey.includes('your_brevo_api_key_here')) {
    throw new Error('Brevo API Key is missing. Please configure BREVO_API_KEY in your .env file or run with --mock.');
  }
  if (!senderEmail || senderEmail.includes('you@yourdomain.com')) {
    throw new Error('Brevo Sender Email is missing or invalid. Please configure BREVO_SENDER_EMAIL in your .env file.');
  }

  // Convert raw text template newlines to HTML br tags for deliverability
  const htmlContent = emailDetails.bodyText.replace(/\n/g, '<br>');

  const payload = {
    sender: {
      name: senderName,
      email: senderEmail
    },
    to: [
      {
        email: emailDetails.toEmail,
        name: emailDetails.toName
      }
    ],
    subject: emailDetails.subject,
    htmlContent: `<html><body>${htmlContent}</body></html>`
  };

  // Attach files if provided (accepts an array of attachment objects or a single attachment object)
  if (emailDetails.attachment) {
    payload.attachment = Array.isArray(emailDetails.attachment)
      ? emailDetails.attachment
      : [emailDetails.attachment];
  }

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    // Brevo returns 201 Created on success
    if (response.status === 201 || response.status === 200) {
      return true;
    }
    return false;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    log.error(`Brevo API Send failed to ${emailDetails.toEmail}: ${errorMsg}`);
    throw new Error(`Brevo send failed: ${errorMsg}`);
  }
}

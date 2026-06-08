import axios from 'axios';
import { log } from './utils.js';

/**
 * Searches for contacts (decision makers, recruiters, tech leads, etc.) at a company domain using Prospeo's search-person.
 * @param {string} domain - The company domain (e.g. stripe.com)
 * @param {number} limit - Maximum number of contacts to return (default 5)
 * @param {Array<string>|string} [seniorities] - Array of seniorities to include, or API key if older signature
 * @param {Array<string>|string} [titles] - Array of job titles to include, or API key if older signature
 * @param {string} [apiKey] - Prospeo API Key
 * @returns {Promise<Array<{firstName: string, lastName: string, title: string, linkedinUrl: string, companyName: string, domain: string}>>}
 */
export async function findContactsForDomain(domain, limit = 5, seniorities = [], titles = [], apiKey) {
  let token = apiKey;
  let finalSeniorities = Array.isArray(seniorities) ? seniorities : [];
  let finalTitles = Array.isArray(titles) ? titles : [];

  // Robust argument mapping if apiKey is passed in place of seniorities or titles
  if (typeof seniorities === 'string') {
    token = seniorities;
    finalSeniorities = [];
  } else if (typeof titles === 'string') {
    token = titles;
    finalTitles = [];
  }

  token = token || process.env.PROSPEO_API_KEY;
  const url = 'https://api.prospeo.io/search-person';

  if (!token || token.includes('your_prospeo_api_key_here')) {
    throw new Error('Prospeo API Key is missing. Please configure PROSPEO_API_KEY in your .env file or run with --mock.');
  }

  // Construct request body with dynamic filters
  const filters = {
    company: {
      websites: {
        include: [domain]
      }
    }
  };

  // Only apply seniority filter if seniorities is not empty and doesn't contain 'All' (case-insensitive)
  const hasSeniorityFilter = finalSeniorities.length > 0 && 
    !finalSeniorities.some(s => typeof s === 'string' && s.toLowerCase() === 'all');
  
  if (hasSeniorityFilter) {
    filters.person_seniority = {
      include: finalSeniorities
    };
  }

  // Only apply job title filter if titles is not empty and doesn't contain 'All' (case-insensitive)
  const hasTitleFilter = finalTitles.length > 0 && 
    !finalTitles.some(t => typeof t === 'string' && t.toLowerCase() === 'all');

  if (hasTitleFilter) {
    filters.person_job_title = {
      include: finalTitles
    };
  }

  const payload = {
    filters,
    page: 1
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'X-KEY': token,
        'Content-Type': 'application/json'
      }
    });

    const results = response.data?.response?.results || response.data?.results || [];

    // Process results up to limit
    const contacts = results.slice(0, limit).map(item => {
      const companyName = item.company?.name || '';
      const person = item.person || {};
      return {
        firstName: person.first_name || '',
        lastName: person.last_name || '',
        title: person.current_job_title || 'Decision Maker',
        linkedinUrl: person.linkedin_url || '',
        companyName,
        domain
      };
    });

    return contacts;

  } catch (error) {
    const errorMsg = error.response?.data?.filter_error || error.response?.data?.message || error.response?.data?.error_code || error.message;
    log.error(`Prospeo search-person API failed for ${domain}: ${errorMsg}`);
    throw new Error(`Prospeo search failed: ${errorMsg}`);
  }
}

/**
 * Enriches a contact to retrieve their verified email address and LinkedIn profile.
 * @param {Object} contact - Contact details (firstName, lastName, domain, and/or linkedinUrl)
 * @param {string} apiKey - Prospeo API Key
 * @returns {Promise<{email: string, emailStatus: string, linkedinUrl: string, firstName: string, lastName: string}>}
 */
export async function enrichContact(contact, apiKey) {
  const token = apiKey || process.env.PROSPEO_API_KEY;
  const url = 'https://api.prospeo.io/enrich-person';

  if (!token || token.includes('your_prospeo_api_key_here')) {
    throw new Error('Prospeo API Key is missing. Please configure PROSPEO_API_KEY in your .env file or run with --mock.');
  }

  // Build enrichment data payload
  const data = {};
  if (contact.linkedinUrl) {
    data.linkedin_url = contact.linkedinUrl;
  } else {
    data.first_name = contact.firstName;
    data.last_name = contact.lastName;
    data.company_website = contact.domain;
  }

  const payload = {
    only_verified_email: true,
    data
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'X-KEY': token,
        'Content-Type': 'application/json'
      }
    });

    const personData = response.data?.person || {};
    const emailData = personData.email || {};

    return {
      email: emailData.email || '',
      emailStatus: emailData.status || 'unknown',
      linkedinUrl: personData.linkedin_url || contact.linkedinUrl || '',
      firstName: personData.first_name || contact.firstName,
      lastName: personData.last_name || contact.lastName
    };

  } catch (error) {
    const errorMsg = error.response?.data?.filter_error || error.response?.data?.message || error.response?.data?.error_code || error.message;
    log.error(`Prospeo enrich-person API failed for ${contact.firstName} ${contact.lastName}: ${errorMsg}`);
    throw new Error(`Prospeo enrichment failed: ${errorMsg}`);
  }
}

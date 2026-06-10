import axios from 'axios';
import { log } from './utils.js';

/**
 * Searches for contacts at a domain using Hunter.io's Domain Search API.
 * 
 * @param {string} domain - Target company domain (e.g. stripe.com)
 * @param {number} limit - Max contacts to return
 * @param {string} apiKey - Hunter.io API Key
 * @returns {Promise<Array<{firstName: string, lastName: string, title: string, email: string, emailStatus: string, companyName: string, domain: string}>>}
 */
export async function searchContactsByDomain(domain, limit = 5, apiKey) {
  const token = apiKey || process.env.HUNTER_API_KEY;
  const url = 'https://api.hunter.io/v2/domain-search';

  if (!token || token.includes('your_hunter_api_key_here')) {
    log.info(`Hunter.io API Key is not configured. Skipping Hunter fallback for ${domain}.`);
    return [];
  }

  try {
    log.info(`[Hunter.io] Querying domain search for ${domain}...`);
    const response = await axios.get(url, {
      params: {
        domain: domain,
        api_key: token,
        limit: limit
      },
      timeout: 8000
    });

    const emails = response.data?.data?.emails || [];
    const organization = response.data?.data?.organization || domain.split('.')[0];

    return emails.slice(0, limit).map(item => {
      const emailStatus = (item.confidence || 0) >= 80 ? 'verified' : 'unknown';
      return {
        firstName: item.first_name || '',
        lastName: item.last_name || '',
        title: item.position || 'Team Member',
        email: item.value || '',
        emailStatus: emailStatus,
        companyName: organization,
        domain: domain,
        linkedinUrl: '' // Hunter.io doesn't always provide LinkedIn URLs
      };
    });

  } catch (error) {
    const errorMsg = error.response?.data?.errors?.[0]?.details || error.response?.data?.message || error.message;
    log.warn(`[Hunter.io] API request failed: ${errorMsg}`);
    return [];
  }
}

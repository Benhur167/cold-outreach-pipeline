import axios from 'axios';
import { log } from './utils.js';

/**
 * Searches for companies on Apollo.io.
 * @param {string} query - Keyword or search term for company names/keywords
 * @param {number} limit - Maximum number of results to return (default 10)
 * @param {string} apiKey - Apollo.io API Key
 * @returns {Promise<Array<{name: string, domain: string}>>}
 */
export async function searchCompanies(query, limit = 10, apiKey) {
  const token = apiKey || process.env.APOLLO_API_KEY;
  const url = 'https://api.apollo.io/api/v1/mixed_companies/search';

  if (!token || token.includes('your_apollo_api_key_here')) {
    throw new Error('Apollo.io API Key is missing. Please configure APOLLO_API_KEY in your .env file or run with --mock.');
  }

  // Construct search payload for Apollo.io
  const tags = query.split(',').map(t => t.trim()).filter(Boolean);
  const payload = {
    q_organization_keyword_tags: tags,
    page: 1,
    per_page: limit
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const organizations = response.data?.organizations || [];
    
    return organizations.map(org => {
      const name = org.name || 'Unknown Company';
      const domain = org.primary_domain || org.domain || (org.website_url ? org.website_url.replace(/https?:\/\/(www\.)?/, '').split('/')[0] : '');
      return { name, domain };
    }).filter(company => company.domain);

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    log.error(`Apollo.io API Request failed: ${errorMsg}`);
    throw new Error(`Apollo.io search failed: ${errorMsg}`);
  }
}

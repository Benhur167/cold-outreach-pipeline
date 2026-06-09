import axios from 'axios';
import { log } from './utils.js';

/**
 * Searches for companies on Ocean.io.
 * @param {string} query - Keyword or industry search term
 * @param {number} limit - Maximum number of results to return (default 10)
 * @param {string} apiKey - Ocean.io API Key
 * @param {string} apiUrl - Ocean.io API URL
 * @returns {Promise<Array<{name: string, domain: string}>>}
 */
export async function searchCompanies(query, limit = 10, apiKey, apiUrl) {
  const token = apiKey || process.env.OCEAN_API_KEY;
  const url = apiUrl || process.env.OCEAN_API_URL || 'https://api.ocean.io/v3/search/companies';

  if (!token || token.includes('your_ocean_api_key_here')) {
    throw new Error('Ocean.io API Key is missing. Please configure OCEAN_API_KEY in your .env file or run with --mock.');
  }

  // Construct search payload based on user's query
  const keywords = query.split(',').map(t => t.trim()).filter(Boolean);
  const payload = {
    size: limit,
    companiesFilters: {
      keywords: keywords,
      keywordsOperator: 'Any of'
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'X-Api-Token': token,
        'Content-Type': 'application/json'
      }
    });

    // Parse response
    // Ocean.io usually returns results in response.data.results or response.data.companies
    const results = response.data?.results || response.data?.companies || response.data || [];
    
    return results.map(item => {
      // Safely extract domain and company name
      const name = item.name || item.companyName || 'Unknown Company';
      const domain = item.domain || item.website || item.websiteUrl || '';
      return { name, domain };
    }).filter(company => company.domain); // Only return companies that have a domain

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    log.error(`Ocean.io API Request failed: ${errorMsg}`);
    throw new Error(`Ocean.io search failed: ${errorMsg}`);
  }
}

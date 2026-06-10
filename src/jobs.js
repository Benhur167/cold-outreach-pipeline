import axios from 'axios';
import { log } from './utils.js';
import { searchCompanies as apolloSearch } from './apollo.js';
import { searchCompanies as oceanSearch } from './ocean.js';

/**
 * Discovers companies actively hiring for a specific category and seniority level.
 * Queries The Muse and Arbeitnow APIs.
 * 
 * @param {string} category - Job category (e.g. 'Software Engineering')
 * @param {string} level - Career level (e.g. 'Internship', 'Entry Level')
 * @param {number} limit - Maximum number of companies to return
 * @param {boolean} isMock - True to run in mock simulation mode
 * @returns {Promise<Array<{name: string, jobTitle: string, source: string}>>}
 */
export async function discoverHiringCompanies(category = 'Software Engineering', level = 'Internship', limit = 5, isMock = false) {
  if (isMock) {
    log.info(`[Mock] Simulating active job search for "${category}" at "${level}" level...`);
    return [
      { name: 'Coursera', jobTitle: 'Software Engineering Intern', source: 'The Muse (Mock)' },
      { name: 'Cloudflare', jobTitle: 'SDE Intern, Infrastructure', source: 'The Muse (Mock)' },
      { name: 'Figma', jobTitle: 'Frontend Developer Intern', source: 'The Muse (Mock)' },
      { name: 'SumUp', jobTitle: 'Mobile Web Developer Intern', source: 'Arbeitnow (Mock)' },
      { name: 'Roku', jobTitle: 'Android Systems Intern', source: 'The Muse (Mock)' }
    ].slice(0, limit);
  }

  const companies = [];
  const seenNames = new Set();

  // 1. Query The Muse API (highly targeted filtering)
  log.info(`Searching jobs on The Muse API for Category: "${category}", Level: "${level}"...`);
  try {
    const museResponse = await axios.get('https://www.themuse.com/api/public/jobs', {
      params: {
        page: 1,
        level: level,
        category: category
      },
      timeout: 8000
    });

    const results = museResponse.data?.results || [];
    for (const job of results) {
      const companyName = job.company?.name;
      if (companyName && !seenNames.has(companyName.toLowerCase())) {
        seenNames.add(companyName.toLowerCase());
        companies.push({
          name: companyName,
          jobTitle: job.name || 'Software Engineer',
          source: 'The Muse'
        });
      }
    }
  } catch (err) {
    log.warn(`The Muse API job search failed: ${err.message}`);
  }

  // If we already reached our limit, return early
  if (companies.length >= limit) {
    return companies.slice(0, limit);
  }

  // 2. Query Arbeitnow API (general developer aggregator)
  log.info('Searching jobs on Arbeitnow API...');
  try {
    const response = await axios.get('https://www.arbeitnow.com/api/job-board-api', { timeout: 8000 });
    const data = response.data?.data || [];

    // Keywords to filter Arbeitnow listings locally
    const categoryKeywords = ['software', 'engineer', 'developer', 'programmer', 'frontend', 'backend', 'fullstack', 'react', 'node', 'android', 'ios', 'web'];
    const levelKeywords = level.toLowerCase() === 'internship' 
      ? ['intern', 'student', 'co-op', 'placement', 'trainee', 'apprentice']
      : ['junior', 'entry', 'associate', 'grad'];

    for (const job of data) {
      const companyName = job.company_name;
      const title = (job.title || '').toLowerCase();
      const tags = (job.tags || []).map(t => t.toLowerCase());

      // Check category match
      const hasCategoryMatch = categoryKeywords.some(kw => title.includes(kw) || tags.some(t => t.includes(kw)));
      // Check level match
      const hasLevelMatch = levelKeywords.some(kw => title.includes(kw) || tags.some(t => t.includes(kw)));

      if (hasCategoryMatch && hasLevelMatch && companyName && !seenNames.has(companyName.toLowerCase())) {
        seenNames.add(companyName.toLowerCase());
        companies.push({
          name: companyName,
          jobTitle: job.title || 'Developer',
          source: 'Arbeitnow'
        });
      }
    }
  } catch (err) {
    log.warn(`Arbeitnow API job search failed: ${err.message}`);
  }

  return companies.slice(0, limit);
}

/**
 * Dynamically resolves the domain of a company name using Ocean/Apollo standard lookups or domain guessing.
 * 
 * @param {string} companyName - Name of the company
 * @param {boolean} isMock - True to run in mock simulation mode
 * @returns {Promise<string>} - Verified or guessed website domain
 */
export async function resolveCompanyDomain(companyName, isMock = false) {
  if (isMock) {
    const mockDomains = {
      'coursera': 'coursera.org',
      'cloudflare': 'cloudflare.com',
      'figma': 'figma.com',
      'sumup': 'sumup.com',
      'roku': 'roku.com'
    };
    const key = companyName.toLowerCase();
    return mockDomains[key] || `${key.replace(/[^a-z0-9]/g, '')}.com`;
  }

  let domain = '';

  // 1. Try Ocean.io standard search lookup first (most reliable standard key)
  try {
    const oceanResults = await oceanSearch(companyName, 1);
    if (oceanResults && oceanResults[0] && oceanResults[0].domain) {
      domain = oceanResults[0].domain.toLowerCase().trim();
      log.info(`Resolved domain for ${companyName} via Ocean.io: ${domain}`);
    }
  } catch (err) {
    // Fail silently
  }

  // 2. Try Apollo.io standard search fallback
  if (!domain) {
    try {
      const apolloResults = await apolloSearch(companyName, 1);
      if (apolloResults && apolloResults[0] && apolloResults[0].domain) {
        domain = apolloResults[0].domain.toLowerCase().trim();
        log.info(`Resolved domain for ${companyName} via Apollo.io: ${domain}`);
      }
    } catch (err) {
      // Fail silently
    }
  }

  // 3. Guess domain if API lookups fail or lack credentials
  if (!domain) {
    const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    domain = `${cleanName}.com`;
    log.info(`Resolution failed/skipped for ${companyName}. Guessed domain: ${domain}`);
  }

  return domain;
}

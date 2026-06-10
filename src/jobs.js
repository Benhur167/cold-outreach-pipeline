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
export async function discoverHiringCompanies(category = 'Software Engineering', level = 'Internship', location = '', limit = 5, isMock = false) {
  if (isMock) {
    log.info(`[Mock] Simulating active job search for "${category}" at "${level}" level in location "${location || 'All'}"...`);
    return [
      { name: 'Coursera', jobTitle: 'Software Engineering Intern', source: 'The Muse (Mock)' },
      { name: 'Cloudflare', jobTitle: 'SDE Intern, Infrastructure', source: 'The Muse (Mock)' },
      { name: 'Figma', jobTitle: 'Frontend Developer Intern', source: 'The Muse (Mock)' },
      { name: 'SumUp', jobTitle: 'Mobile Web Developer Intern', source: 'Arbeitnow (Mock)' },
      { name: 'Khaata', jobTitle: 'Python Developer Intern', source: 'Hasjob India (Mock)', resolvedDomain: 'khaata.in' },
      { name: 'Roku', jobTitle: 'Android Systems Intern', source: 'The Muse (Mock)' }
    ].slice(0, limit);
  }

  const companies = [];
  const seenNames = new Set();

  // 1. Query The Muse API (highly targeted filtering)
  log.info(`Searching jobs on The Muse API for Category: "${category}", Level: "${level}"...`);
  try {
    const params = {
      page: 1,
      level: level,
      category: category
    };

    const firstResponse = await axios.get('https://www.themuse.com/api/public/jobs', {
      params,
      timeout: 8000
    });

    const pageCount = firstResponse.data?.page_count || 1;
    const allResults = [...(firstResponse.data?.results || [])];

    // Fetch pages 2 to min(5, pageCount) in parallel to bypass location filter API bug and aggregate results
    const maxPagesToFetch = Math.min(5, pageCount);
    if (maxPagesToFetch > 1) {
      const promises = [];
      for (let p = 2; p <= maxPagesToFetch; p++) {
        promises.push(
          axios.get('https://www.themuse.com/api/public/jobs', {
            params: { ...params, page: p },
            timeout: 8000
          }).then(res => res.data?.results || [])
            .catch(err => {
              log.warn(`Failed to fetch page ${p} from The Muse API: ${err.message}`);
              return [];
            })
        );
      }
      const pagesResults = await Promise.all(promises);
      for (const pageResults of pagesResults) {
        allResults.push(...pageResults);
      }
    }

    for (const job of allResults) {
      const companyName = job.company?.name;
      if (!companyName) continue;

      // Validate location locally to make sure it includes the target country/city or is remote
      if (location) {
        const target = location.toLowerCase();
        const jobLocations = (job.locations || []).map(l => l.name.toLowerCase());
        const hasLocMatch = jobLocations.some(loc => loc.includes(target) || loc.includes('remote') || loc.includes('flexible'));
        if (!hasLocMatch) continue;
      }

      if (!seenNames.has(companyName.toLowerCase())) {
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
      
      // Check location match
      let hasLocationMatch = true;
      if (location) {
        const target = location.toLowerCase();
        const jobLoc = (job.location || '').toLowerCase();
        hasLocationMatch = jobLoc.includes(target) || jobLoc.includes('remote') || (job.remote === true);
      }

      if (hasCategoryMatch && hasLevelMatch && hasLocationMatch && companyName && !seenNames.has(companyName.toLowerCase())) {
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

  // If we already reached our limit, return early
  if (companies.length >= limit) {
    return companies.slice(0, limit);
  }

  // 3. Query Hasjob Atom Feed (India startup board)
  log.info('Searching jobs on Hasjob India feed...');
  try {
    const response = await axios.get('https://hasjob.co/feed', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });

    const entryMatches = response.data.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
    for (const match of entryMatches) {
      if (companies.length >= limit) break;

      const content = match[1];
      const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const linkMatch = content.match(/<link[^>]*href="([^"]+)"[^>]*\/>/) || content.match(/<link[^>]*href="([^"]+)"[^>]*>/);
      const locationMatch = content.match(/<location[^>]*>([\s\S]*?)<\/location>/);
      
      if (titleMatch && linkMatch) {
        const title = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
        const link = linkMatch[1].trim();
        const jobLoc = locationMatch ? locationMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim().toLowerCase() : '';
        const titleLower = title.toLowerCase();

        // Extract company domain/slug from link
        let companyDomain = '';
        let companyName = '';
        try {
          const urlObj = new URL(link);
          const parts = urlObj.pathname.split('/').filter(Boolean);
          if (parts.length >= 1) {
            companyDomain = parts[0]; // e.g. 'capa.cloud' or 'schematise.tech'
            // If it is a domain, use domain name for company name
            if (companyDomain.includes('.')) {
              companyName = companyDomain.split('.')[0];
              companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
            } else {
              companyName = companyDomain.charAt(0).toUpperCase() + companyDomain.slice(1);
              companyDomain = ''; // Guess it later
            }
          }
        } catch (e) {
          continue;
        }

        if (!companyName) continue;

        // Keywords to filter Hasjob listings locally
        const categoryKeywords = ['software', 'engineer', 'developer', 'programmer', 'frontend', 'backend', 'fullstack', 'react', 'node', 'android', 'ios', 'web'];
        const levelKeywords = level.toLowerCase() === 'internship' 
          ? ['intern', 'student', 'co-op', 'placement', 'trainee', 'apprentice']
          : ['junior', 'entry', 'associate', 'grad'];

        // Check category match
        const hasCategoryMatch = categoryKeywords.some(kw => titleLower.includes(kw));
        
        // Check level match
        const hasLevelMatch = levelKeywords.some(kw => titleLower.includes(kw));

        // Check location match
        let hasLocationMatch = true;
        if (location) {
          const target = location.toLowerCase();
          hasLocationMatch = jobLoc.includes(target) || 
                             jobLoc.includes('remote') || 
                             jobLoc.includes('anywhere') || 
                             jobLoc.includes('flexible') ||
                             (target === 'india' && (jobLoc.includes('remote') || jobLoc.includes('anywhere')));
        }

        if (hasCategoryMatch && hasLevelMatch && hasLocationMatch) {
          const key = companyName.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            companies.push({
              name: companyName,
              jobTitle: title,
              source: 'Hasjob India',
              resolvedDomain: companyDomain || null
            });
          }
        }
      }
    }
  } catch (err) {
    log.warn(`Hasjob India job search failed: ${err.message}`);
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

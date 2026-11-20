/**
 * GET /admin/api/dashboard   Dashboard overview data
 *
 * Returns key metrics and analytics for the admin dashboard.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Returns aggregated data without exposing sensitive user information
 */

import { json } from "../../_lib/common.js";
import { requireAdmin } from "../../_lib/admin-auth.js";
import { queryD1, queryFirstD1, getDatabaseFromEnv } from "../../_lib/d1-helper.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    // Get waitlist statistics
    const waitlistStats = await getWaitlistStats(env);
    
    // Get growth data (registrations by date)
    const growthData = await getGrowthData(env);
    
    // Get country distribution
    const countryData = await getCountryData(env);
    
    // Get referral analytics
    const referralData = await getReferralData(env);
    
    // Return dashboard data
    return json({
      totalRegistrations: waitlistStats.total,
      verifiedRegistrations: waitlistStats.verified,
      pendingRegistrations: waitlistStats.pending,
      invitationsSent: waitlistStats.invited,
      usersJoined: waitlistStats.joined,
      growthData,
      countryData,
      totalReferrals: referralData.total,
      topReferrer: referralData.topReferrer,
      conversionRate: referralData.conversionRate
    });
    
  } catch (error) {
    console.error("[admin] Error loading dashboard data:", error);
    return json({ error: "Failed to load dashboard data" }, { status: 500 });
  }
}

/**
 * Get waitlist statistics
 */
async function getWaitlistStats(env) {
  const db = getDatabaseFromEnv(env);
  const stats = await queryD1(db, `
    SELECT 
      status,
      COUNT(*) as count
    FROM waitlist
    GROUP BY status
  `);
  
  const result = {
    total: 0,
    pending: 0,
    verified: 0,
    invited: 0,
    joined: 0
  };
  
  stats.forEach(row => {
    result.total += row.count;
    result[row.status] = row.count;
  });
  
  return result;
}

/**
 * Get growth data (registrations by date)
 */
async function getGrowthData(env) {
  const db = getDatabaseFromEnv(env);
  const growth = await queryD1(db, `
    SELECT 
      DATE(created_at / 1000, 'unixepoch') as date,
      COUNT(*) as count
    FROM waitlist
    WHERE created_at >= ?  -- Last 30 days
    GROUP BY DATE(created_at / 1000, 'unixepoch')
    ORDER BY date
  `, [Date.now() - 30 * 24 * 60 * 60 * 1000]);
  
  return growth.map(row => ({
    date: row.date,
    count: row.count
  }));
}

/**
 * Get country distribution
 */
async function getCountryData(env) {
  const db = getDatabaseFromEnv(env);
  const countries = await queryD1(db, `
    SELECT 
      country,
      COUNT(*) as count
    FROM waitlist
    WHERE country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY count DESC
    LIMIT 10
  `);
  
  return countries.map(row => ({
    name: row.country,
    count: row.count
  }));
}

/**
 * Get referral analytics
 */
async function getReferralData(env) {
  const db = getDatabaseFromEnv(env);
  
  // Get total referrals
  const totalReferrals = await queryFirstD1(db, `
    SELECT COUNT(*) as count
    FROM waitlist
    WHERE referred_by IS NOT NULL
  `);
  
  // Get top referrer
  const topReferrer = await queryFirstD1(db, `
    SELECT 
      u.name,
      COUNT(*) as referral_count
    FROM waitlist w
    JOIN waitlist u ON w.referred_by = u.id
    GROUP BY u.id, u.name
    ORDER BY referral_count DESC
    LIMIT 1
  `);
  
  // Calculate conversion rate (invited / verified)
  const invited = await queryFirstD1(db, `
    SELECT COUNT(*) as count
    FROM waitlist
    WHERE status = 'invited' OR status = 'joined'
  `);
  
  const verified = await queryFirstD1(db, `
    SELECT COUNT(*) as count
    FROM waitlist
    WHERE status = 'verified'
  `);
  
  const conversionRate = verified.count > 0 
    ? Math.round((invited.count / verified.count) * 100) 
    : 0;
  
  return {
    total: totalReferrals.count,
    topReferrer: topReferrer ? `${topReferrer.name} (${topReferrer.referral_count})` : 'N/A',
    conversionRate: `${conversionRate}%`
  };
}
const logger = require('./logger');

class CallIdStorage {
  constructor() {
    this.processedCallIds = new Set();
    this.setupMidnightCleanup();
  }

  /**
   * Check if a call ID has been processed
   * @param {string} callId - The call ID to check
   * @returns {boolean} - True if already processed, false otherwise
   */
  hasBeenProcessed(callId) {
    return this.processedCallIds.has(callId);
  }

  /**
   * Mark a call ID as processed
   * @param {string} callId - The call ID to mark as processed
   */
  markAsProcessed(callId) {
    this.processedCallIds.add(callId);
    logger.info('Call ID marked as processed', { 
      callId, 
      totalProcessed: this.processedCallIds.size 
    });
  }

  /**
   * Clear all stored call IDs
   */
  clearAll() {
    const previousSize = this.processedCallIds.size;
    this.processedCallIds.clear();
    logger.info('Call ID storage cleared', { 
      clearedCount: previousSize,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get the next midnight PST time
   * @returns {Date} - Next midnight PST
   */
  getNextMidnightPST() {
    const now = new Date();
    
    // Create a date for midnight PST today
    const midnightPST = new Date(now);
    
    // Convert to PST (UTC-8 or UTC-7 during daylight saving)
    // For simplicity, we'll use America/Los_Angeles timezone
    const pstOffset = this.getPSTOffset(now);
    
    // Set to midnight in PST
    midnightPST.setUTCHours(8 - pstOffset, 0, 0, 0); // 8 AM UTC = 12 AM PST (standard time)
    
    // If we've already passed midnight today, set to tomorrow
    if (now >= midnightPST) {
      midnightPST.setDate(midnightPST.getDate() + 1);
    }
    
    return midnightPST;
  }

  /**
   * Get PST offset accounting for daylight saving time
   * @param {Date} date - The date to check
   * @returns {number} - Offset from UTC (8 for standard time, 7 for daylight saving)
   */
  getPSTOffset(date) {
    // PST is UTC-8, PDT is UTC-7
    // Daylight saving time in California:
    // - Starts: Second Sunday in March
    // - Ends: First Sunday in November
    
    const year = date.getFullYear();
    const marchSecondSunday = this.getNthSundayOfMonth(year, 2, 2); // March = 2 (0-indexed)
    const novemberFirstSunday = this.getNthSundayOfMonth(year, 10, 1); // November = 10
    
    // Check if we're in daylight saving time
    if (date >= marchSecondSunday && date < novemberFirstSunday) {
      return 7; // PDT (UTC-7)
    }
    return 8; // PST (UTC-8)
  }

  /**
   * Get the nth Sunday of a specific month
   * @param {number} year - The year
   * @param {number} month - The month (0-indexed)
   * @param {number} n - Which Sunday (1st, 2nd, etc.)
   * @returns {Date} - The date of the nth Sunday
   */
  getNthSundayOfMonth(year, month, n) {
    const firstDay = new Date(year, month, 1);
    const firstSunday = new Date(year, month, 1 + (7 - firstDay.getDay()) % 7);
    
    // Add weeks to get to the nth Sunday
    firstSunday.setDate(firstSunday.getDate() + (n - 1) * 7);
    
    // Set to 2 AM local time (when DST changes occur)
    firstSunday.setHours(2, 0, 0, 0);
    
    return firstSunday;
  }

  /**
   * Setup the midnight cleanup scheduler
   */
  setupMidnightCleanup() {
    const scheduleNextCleanup = () => {
      const nextMidnight = this.getNextMidnightPST();
      const msUntilMidnight = nextMidnight - new Date();
      
      logger.info('Scheduling call ID cleanup', {
        nextCleanup: nextMidnight.toISOString(),
        hoursUntilCleanup: (msUntilMidnight / 1000 / 60 / 60).toFixed(2)
      });
      
      setTimeout(() => {
        this.clearAll();
        scheduleNextCleanup(); // Schedule the next cleanup
      }, msUntilMidnight);
    };
    
    // Start the scheduler
    scheduleNextCleanup();
  }

  /**
   * Get storage statistics
   * @returns {Object} - Storage statistics
   */
  getStats() {
    return {
      processedCallIds: this.processedCallIds.size,
      nextCleanup: this.getNextMidnightPST().toISOString()
    };
  }
}

// Export a singleton instance
module.exports = new CallIdStorage();
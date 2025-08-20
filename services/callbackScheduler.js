const db = require("../db/connection");
const logger = require("../utils/logger");
const retellService = require("./retellService");
const RedoxAPIService = require("./redoxApiService");
const RedoxTransformer = require("../utils/redoxTransformer");
const AuthService = require("./authService");

const authService = new AuthService();

class CallbackScheduler {
  constructor() {
    this.intervalId = null;
    this.isProcessing = false;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Start the callback scheduler
   */
  start() {
    if (this.intervalId) {
      logger.warn("Callback scheduler is already running");
      return;
    }

    logger.info("Starting callback scheduler", {
      intervalMinutes: this.intervalMs / 60000,
    });

    // Run immediately on start
    this.processCallbacks();

    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.processCallbacks();
    }, this.intervalMs);
  }

  /**
   * Stop the callback scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Callback scheduler stopped");
    }
  }

  /**
   * Process pending callbacks within the next 5-minute window
   */
  async processCallbacks() {
    // Prevent concurrent processing
    if (this.isProcessing) {
      logger.info("Callback processing already in progress, skipping");
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + this.intervalMs);

      logger.info("Processing scheduled callbacks", {
        windowStart: now.toISOString(),
        windowEnd: windowEnd.toISOString(),
      });

      // Query for pending callbacks within the time window
      const query = `
        SELECT id, patient_id, agent_callback_number, scheduled_time
        FROM scheduled_callbacks
        WHERE status = 'pending'
          AND scheduled_time >= $1
          AND scheduled_time < $2
        ORDER BY scheduled_time ASC
      `;

      const result = await db.query(query, [now, windowEnd]);

      if (result.rows.length === 0) {
        logger.info("No callbacks to process in this window");
        return;
      }

      logger.info(`Found ${result.rows.length} callbacks to process`);

      // Process each callback
      for (const callback of result.rows) {
        await this.processSingleCallback(callback);
      }
    } catch (error) {
      logger.error("Error processing callbacks", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single callback
   * @param {Object} callback - The callback record from database
   */
  async processSingleCallback(callback) {
    const { id, patient_id, agent_callback_number, scheduled_time } = callback;

    logger.info("Processing callback", {
      callbackId: id,
      patientId: patient_id,
      agentCallbackNumber: agent_callback_number,
      scheduledTime: scheduled_time,
    });

    try {
      // Get access token
      const accessToken = await authService.getAccessToken();

      // Fetch patient details from Redox
      const patientResponse = await RedoxAPIService.makeRequest(
        "GET",
        `/Patient/${patient_id}`,
        null,
        null,
        accessToken
      );

      if (!patientResponse || !patientResponse.id) {
        throw new Error(`Patient not found: ${patient_id}`);
      }

      // Transform patient data
      const patientData = RedoxTransformer.transformPatientSearchResponse({
        entry: [{ resource: patientResponse }],
      })[0];

      if (!patientData.phone) {
        throw new Error(`Patient phone number not found for patient: ${patient_id}`);
      }

      // Search for appointments
      let appointments = [];
      try {
        const appointmentSearchParams =
          RedoxTransformer.createAppointmentSearchParams(patient_id);
        const appointmentResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Appointment/_search",
          null,
          appointmentSearchParams,
          accessToken
        );
        appointments =
          RedoxTransformer.transformAppointmentSearchResponse(appointmentResponse);
      } catch (appointmentError) {
        logger.warn("Failed to fetch appointments for callback", {
          error: appointmentError.message,
          patientId: patient_id,
        });
      }

      // Get the most recent appointment
      const appointment = appointments.length > 0 ? appointments[0] : null;

      // Prepare dynamic variables for the callback
      const dynamicVariables = {
        // Call context
        call_type: "callback",
        access_token: accessToken,

        // Patient details
        patient_id: patient_id,
        patient_name: patientData.fullName || "",
        patient_phone: patientData.phone || "",
        patient_email: patientData.email || "",
        patient_dob: patientData.dateOfBirth || "",
        patient_zip: patientData.zipCode || "",
        patient_address: patientData.address || "",
        patient_insurance_name: patientData.insuranceName || "",
        insurance_type: patientData.insuranceType || "",
        patient_insurance_member_id: patientData.insuranceMemberId || "",

        // Appointment details if available
        patient_appointment_id: appointment?.appointmentId || "",
        patient_appointment_type: appointment?.appointmentType || "",
        appointment_start: appointment?.startTime || "",
        patient_appointment_status: appointment?.status || "",
        appointment_description: appointment?.description || "",
      };

      // Determine which Retell service method to use based on agent number
      let callResponse;
      if (agent_callback_number === "+16018846979") {
        // Scheduling agent
        callResponse = await retellService.createSchedulingCall(
          patientData.phone,
          dynamicVariables
        );
      } else if (agent_callback_number === "+14088728200") {
        // Intake agent
        callResponse = await retellService.createIntakeCall(
          patientData.phone,
          dynamicVariables
        );
      } else {
        throw new Error(`Unknown agent callback number: ${agent_callback_number}`);
      }

      // Update callback status to completed
      await db.query(
        `UPDATE scheduled_callbacks 
         SET status = 'completed', 
             processed_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [id]
      );

      logger.info("Callback processed successfully", {
        callbackId: id,
        patientId: patient_id,
        retellCallId: callResponse.call_id,
        retellCallStatus: callResponse.status,
      });
    } catch (error) {
      logger.error("Error processing callback", {
        callbackId: id,
        patientId: patient_id,
        error: error.message,
      });

      // Update callback status to failed
      await db.query(
        `UPDATE scheduled_callbacks 
         SET status = 'failed', 
             processed_at = CURRENT_TIMESTAMP,
             error_message = $2
         WHERE id = $1`,
        [id, error.message]
      );
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: !!this.intervalId,
      processing: this.isProcessing,
      intervalMinutes: this.intervalMs / 60000,
    };
  }

  /**
   * Get statistics about scheduled callbacks
   */
  async getStats() {
    try {
      const statsQuery = `
        SELECT 
          status,
          COUNT(*) as count
        FROM scheduled_callbacks
        GROUP BY status
      `;

      const upcomingQuery = `
        SELECT COUNT(*) as count
        FROM scheduled_callbacks
        WHERE status = 'pending'
          AND scheduled_time > CURRENT_TIMESTAMP
          AND scheduled_time <= CURRENT_TIMESTAMP + INTERVAL '5 minutes'
      `;

      const [statsResult, upcomingResult] = await Promise.all([
        db.query(statsQuery),
        db.query(upcomingQuery),
      ]);

      const stats = {
        pending: 0,
        completed: 0,
        failed: 0,
      };

      statsResult.rows.forEach((row) => {
        stats[row.status] = parseInt(row.count);
      });

      stats.upcomingInNext5Minutes = parseInt(upcomingResult.rows[0].count);

      return stats;
    } catch (error) {
      logger.error("Error getting callback stats", {
        error: error.message,
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new CallbackScheduler();
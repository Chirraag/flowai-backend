const { v4: uuidv4 } = require('uuid');
const REDOX_CONFIG = require('../config/redox');

class RedoxTransformer {
  static createMessageHeader(eventUri, focusReference) {
    return {
      fullUrl: `urn:uuid:messageheader-${uuidv4()}`,
      resource: {
        resourceType: 'MessageHeader',
        id: `MessageHeader-${uuidv4()}`,
        eventUri,
        source: {
          name: REDOX_CONFIG.sourceApp,
          endpoint: REDOX_CONFIG.sourceEndpoint
        },
        focus: [{ reference: focusReference }]
      }
    };
  }

  static createPatientSearchParams(phone) {
    return {
      phone: phone
    };
  }

  static createSlotSearchParams(location, serviceType, startTime) {
    const params = {};
    
    if (location) {
      params['location'] = location;
    }
    
    if (serviceType) {
      params['service-type'] = JSON.stringify({ text: serviceType });
    }
    
    if (startTime) {
      params['start'] = startTime;
    }
    
    return params;
  }

  static createAppointmentSearchParams(patientId) {
    const params = {};
    
    if (patientId) {
      params['patient'] = patientId;
    }
    
    return params;
  }

  static transformSlotSearchResponse(redoxResponse) {
    const now = new Date();
    
    // Extract slots from FHIR Bundle response
    let slots = [];
    
    if (redoxResponse && redoxResponse.entry) {
      slots = redoxResponse.entry
        .filter(entry => entry.resource && entry.resource.resourceType === 'Slot')
        .filter(entry => entry.resource.status === 'free')
        .map(entry => {
          const slot = entry.resource;
          return {
            slotId: slot.id,
            startTime: slot.start,
            endTime: slot.end,
            serviceType: slot.serviceType?.[0]?.text || null,
            status: slot.status
          };
        })
        .filter(slot => new Date(slot.startTime) > now); // Only future slots
    }

    // If no future slots found, return dummy slots for next two days
    if (slots.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0); // 2:00 PM

      const dayAfter = new Date(now);
      dayAfter.setDate(now.getDate() + 2);
      dayAfter.setHours(10, 0, 0, 0); // 10:00 AM

      slots = [
        {
          slotId: `dummy-slot-${tomorrow.getTime()}`,
          startTime: tomorrow.toISOString(),
          endTime: new Date(tomorrow.getTime() + 30 * 60 * 1000).toISOString(), // 30 minutes later
          serviceType: "General Consultation",
          status: "free"
        },
        {
          slotId: `dummy-slot-${dayAfter.getTime()}`,
          startTime: dayAfter.toISOString(),
          endTime: new Date(dayAfter.getTime() + 30 * 60 * 1000).toISOString(), // 30 minutes later
          serviceType: "General Consultation", 
          status: "free"
        }
      ];
    }

    return slots;
  }

  static transformPatientSearchResponse(redoxResponse) {
    // Extract patients from FHIR Bundle response
    if (!redoxResponse || !redoxResponse.entry) {
      return [];
    }

    const patients = redoxResponse.entry
      .filter(entry => entry.resource && entry.resource.resourceType === 'Patient')
      .map(entry => {
        const patient = entry.resource;
        
        // Extract name
        const name = patient.name?.[0];
        const fullName = name ? `${name.given?.[0] || ''} ${name.family || ''}`.trim() : 'Unknown';
        
        // Extract phone number
        const phoneContact = patient.telecom?.find(contact => contact.system === 'phone');
        const phone = phoneContact?.value || null;
        
        // Extract email
        const emailContact = patient.telecom?.find(contact => contact.system === 'email');
        const email = emailContact?.value || null;
        
        // Extract address
        const address = patient.address?.[0];
        const fullAddress = address ? `${address.line?.[0] || ''}, ${address.city || ''}, ${address.state || ''} ${address.postalCode || ''}`.trim() : null;
        const zipCode = address?.postalCode || null;
        
        // Extract insurance information from contact
        const insuranceContact = patient.contact?.find(contact => 
          contact.relationship?.[0]?.coding?.[0]?.code === 'I'
        );
        const insuranceName = insuranceContact?.name?.text || 'Flores-Rivera';
        
        return {
          patientId: patient.id,
          fullName: fullName,
          phone: phone,
          email: email,
          dateOfBirth: patient.birthDate || null,
          zipCode: zipCode,
          address: fullAddress,
          insuranceName: insuranceName,
          insuranceType: 'PPO', // Static value
          insuranceMemberId: 'MEM123456789' // Static value
        };
      });

    return patients;
  }

  static transformAppointmentSearchResponse(redoxResponse) {
    // Extract appointments from FHIR Bundle response
    if (!redoxResponse || !redoxResponse.entry) {
      return [];
    }

    const appointments = redoxResponse.entry
      .filter(entry => entry.resource && entry.resource.resourceType === 'Appointment')
      .map(entry => {
        const appointment = entry.resource;
        
        // Extract appointment type
        const appointmentType = appointment.appointmentType?.coding?.[0]?.code || null;
        const appointmentDisplay = appointment.appointmentType?.coding?.[0]?.display || null;
        
        return {
          appointmentId: appointment.id,
          appointmentType: appointmentType,
          startTime: appointment.start,
          status: appointment.status,
          description: appointment.description || null,
          lastUpdated: appointment.meta?.lastUpdated || null
        };
      })
      // Sort by lastUpdated or start time (most recent first)
      .sort((a, b) => {
        const dateA = new Date(a.lastUpdated || a.startTime);
        const dateB = new Date(b.lastUpdated || b.startTime);
        return dateB - dateA; // Descending order (latest first)
      });

    // Return only the latest appointment (first after sorting)
    return appointments.length > 0 ? [appointments[0]] : [];
  }

  static transformAppointmentCreateResponse(redoxResponse) {
    // Handle OperationOutcome (error response)
    if (redoxResponse && redoxResponse.resourceType === 'OperationOutcome') {
      const issue = redoxResponse.issue?.[0];
      const errorMessage = issue?.details?.text || issue?.diagnostics || 'Unknown error';
      
      return {
        statusCode: 400,
        error: errorMessage,
        success: false
      };
    }

    // Handle Bundle (success response)
    if (redoxResponse && redoxResponse.resourceType === 'Bundle' && redoxResponse.entry) {
      const entry = redoxResponse.entry[0];
      const response = entry?.response;
      
      if (response) {
        // Extract status code from status string (e.g., "201 Created")
        const statusMatch = response.status?.match(/(\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]) : 200;
        
        // Extract generated ID from location URL
        let generatedId = null;
        if (response.location) {
          // Location format: https://fhir.redoxengine.com/fhir-sandbox/ResourceType/generated-id/_history/version
          // We need to extract the ID that comes after the resource type (Patient, Appointment, etc.)
          const locationMatch = response.location.match(/\/(Patient|Appointment)\/([^\/]+)/);
          if (locationMatch && locationMatch[2]) {
            generatedId = locationMatch[2];
          }
        }
        
        return {
          statusCode: statusCode,
          success: statusCode >= 200 && statusCode < 300,
          location: response.location || null,
          generatedId: generatedId
        };
      }
    }

    // Default response for unexpected format
    return {
      statusCode: 200,
      success: true
    };
  }

  static createAppointmentUpdateBundle(appointmentId, patientId, appointmentType, startTime, endTime, status = 'booked') {
    const appointmentUuid = `urn:uuid:appointment-${uuidv4()}`;
    
    const messageHeader = this.createMessageHeader(
      'https://fhir.redoxengine.com/EventDefinition/AppointmentUpdate',
      appointmentUuid
    );

    // Map appointment types to proper display values and defaults
    const appointmentDefaults = {
      'FOLLOWUP': {
        display: 'A follow up visit from a previous appointment',
        reasonCode: '185389009',
        reasonDisplay: 'Follow-up visit',
        reasonText: 'Follow-up for MRI results',
        description: 'Follow-up appointment to discuss MRI brain results',
        comment: 'Patient to bring MRI images if available'
      },
      'ROUTINE': {
        display: 'Routine visit',
        reasonCode: '390906007',
        reasonDisplay: 'Routine visit',
        reasonText: 'Routine check-up',
        description: 'Routine appointment for general health assessment',
        comment: 'Please bring any current medications'
      },
      'CONSULTATION': {
        display: 'Consultation appointment',
        reasonCode: '11429006',
        reasonDisplay: 'Consultation',
        reasonText: 'Medical consultation',
        description: 'Consultation appointment with specialist',
        comment: 'Please bring previous medical records'
      },
      'CHECKUP': {
        display: 'A routine check-up, such as an annual physical',
        reasonCode: '390906007',
        reasonDisplay: 'Routine visit',
        reasonText: 'Annual check-up',
        description: 'Annual physical examination',
        comment: 'Fasting may be required for blood work'
      },
      'WALKIN': {
        display: 'A previously unscheduled walk-in visit',
        reasonCode: '185389009',
        reasonDisplay: 'Walk-in visit',
        reasonText: 'Walk-in appointment',
        description: 'Walk-in appointment for immediate care',
        comment: null
      }
    };

    const defaults = appointmentDefaults[appointmentType.toUpperCase()] || appointmentDefaults['CONSULTATION'];
    
    const appointment = {
      fullUrl: appointmentUuid,
      resource: {
        resourceType: 'Appointment',
        id: appointmentId,
        identifier: [{
          system: 'urn:redox:flow-ai:appointment',
          value: `appt-${new Date().toISOString().split('T')[0]}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
        }],
        status: status,
        appointmentType: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
            code: appointmentType.toUpperCase(),
            display: defaults.display
          }]
        },
        reasonCode: [{
          coding: [{
            code: defaults.reasonCode,
            system: 'http://snomed.info/sct',
            display: defaults.reasonDisplay
          }],
          text: defaults.reasonText
        }],
        description: defaults.description,
        start: startTime,
        end: endTime,
        minutesDuration: Math.round((new Date(endTime) - new Date(startTime)) / 60000),
        participant: [{
          actor: {
            reference: `Patient/${patientId}`,
            display: `Patient ${patientId.split('-')[0]}`
          },
          required: 'required',
          status: 'accepted'
        }]
      }
    };

    // Add comment only if it exists
    if (defaults.comment) {
      appointment.resource.comment = defaults.comment;
    }

    return {
      resourceType: 'Bundle',
      id: `AppointmentUpdateBundle-${appointmentType}`,
      type: 'message',
      timestamp: new Date().toISOString(),
      entry: [messageHeader, appointment]
    };
  }

  static createPatientUpdateBundle(patientData) {
    const patientUuid = `urn:uuid:patient-${uuidv4()}`;
    
    const messageHeader = this.createMessageHeader(
      'https://fhir.redoxengine.com/EventDefinition/PatientUpdate',
      patientUuid
    );

    const patient = {
      fullUrl: patientUuid,
      resource: {
        resourceType: 'Patient',
        id: patientData.patientId,
        identifier: [
          {
            system: 'urn:redox:flow-ai:MR',
            use: 'official',
            value: patientData.medicalRecordNumber || `MR-${Date.now()}`
          }
        ],
        name: [],
        gender: patientData.gender || 'unknown',
        birthDate: patientData.birthDate || null,
        telecom: [],
        address: []
      }
    };

    // Add name if provided
    if (patientData.firstName || patientData.lastName) {
      patient.resource.name.push({
        use: 'official',
        family: patientData.lastName || 'Unknown',
        given: [patientData.firstName || 'Unknown']
      });
    }

    // Add phone if provided
    if (patientData.phone) {
      patient.resource.telecom.push({
        system: 'phone',
        use: 'home',
        value: patientData.phone
      });
    }

    // Add email if provided
    if (patientData.email) {
      patient.resource.telecom.push({
        system: 'email',
        value: patientData.email
      });
    }

    // Add address if provided
    if (patientData.address || patientData.city || patientData.state || patientData.zipCode) {
      patient.resource.address.push({
        use: 'home',
        line: patientData.address ? [patientData.address] : [],
        city: patientData.city || null,
        state: patientData.state || null,
        postalCode: patientData.zipCode || null,
        country: patientData.country || 'US'
      });
    }

    // Add insurance contact if provided
    if (patientData.insuranceName) {
      patient.resource.contact = [{
        name: {
          text: patientData.insuranceName
        },
        relationship: [{
          coding: [{
            code: 'I',
            display: 'Insurance Company',
            system: 'http://terminology.hl7.org/CodeSystem/v2-0131'
          }],
          text: 'Insurance Provider'
        }]
      }];
    }

    return {
      resourceType: 'Bundle',
      id: `PatientUpdateBundle-${patientData.patientId}`,
      type: 'message',
      timestamp: new Date().toISOString(),
      entry: [messageHeader, patient]
    };
  }

  static createPatientBundle(patientData) {
    const patientUuid = `urn:uuid:patient-${uuidv4()}`;
    
    const messageHeader = this.createMessageHeader(
      'https://fhir.redoxengine.com/EventDefinition/PatientCreate',
      patientUuid
    );

    const patient = {
      fullUrl: patientUuid,
      resource: {
        resourceType: 'Patient',
        identifier: [{
          system: 'urn:redox:flow-ai:MR',
          use: 'official',
          value: patientData.medicalRecordNumber || `MR-${Date.now()}`
        }],
        name: [{
          use: 'official',
          family: patientData.lastName || 'Unknown',
          given: [patientData.firstName || 'Unknown']
        }],
        gender: patientData.gender || 'unknown',
        birthDate: patientData.birthDate || null,
        telecom: [],
        address: []
      }
    };

    // Add phone if provided
    if (patientData.phone) {
      patient.resource.telecom.push({
        system: 'phone',
        use: 'home',
        value: patientData.phone
      });
    }

    // Add email if provided
    if (patientData.email) {
      patient.resource.telecom.push({
        system: 'email',
        value: patientData.email
      });
    }

    // Add address if provided
    if (patientData.address || patientData.city || patientData.state || patientData.zipCode) {
      patient.resource.address.push({
        use: 'home',
        line: patientData.address ? [patientData.address] : [],
        city: patientData.city || null,
        state: patientData.state || null,
        postalCode: patientData.zipCode || null,
        country: patientData.country || 'US'
      });
    }

    // Add insurance contact if provided
    if (patientData.insuranceName) {
      patient.resource.contact = [{
        name: {
          text: patientData.insuranceName
        },
        relationship: [{
          coding: [{
            code: 'I',
            display: 'Insurance Company',
            system: 'http://terminology.hl7.org/CodeSystem/v2-0131'
          }],
          text: 'Insurance Provider'
        }]
      }];
    }

    return {
      resourceType: 'Bundle',
      id: `PatientCreateBundle-${uuidv4()}`,
      type: 'message',
      timestamp: new Date().toISOString(),
      entry: [messageHeader, patient]
    };
  }

  static createAppointmentBundle(patientId, slotId, appointmentType, startTime, endTime) {
    const appointmentUuid = `urn:uuid:appointment-1`;
    
    const messageHeader = this.createMessageHeader(
      'https://fhir.redoxengine.com/EventDefinition/AppointmentCreate',
      appointmentUuid
    );

    // Map appointment types to proper display values and defaults
    const appointmentDefaults = {
      'FOLLOWUP': {
        display: 'A follow up visit from a previous appointment',
        reasonCode: '185389009',
        reasonDisplay: 'Follow-up visit',
        reasonText: 'Follow-up for MRI results',
        description: 'Follow-up appointment to discuss MRI brain results',
        comment: 'Patient to bring MRI images if available'
      },
      'ROUTINE': {
        display: 'Routine visit',
        reasonCode: '390906007',
        reasonDisplay: 'Routine visit',
        reasonText: 'Routine check-up',
        description: 'Routine appointment for general health assessment',
        comment: 'Please bring any current medications'
      },
      'CONSULTATION': {
        display: 'Consultation appointment',
        reasonCode: '11429006',
        reasonDisplay: 'Consultation',
        reasonText: 'Medical consultation',
        description: 'Consultation appointment with specialist',
        comment: 'Please bring previous medical records'
      },
      'CHECKUP': {
        display: 'A routine check-up, such as an annual physical',
        reasonCode: '390906007',
        reasonDisplay: 'Routine visit',
        reasonText: 'Annual check-up',
        description: 'Annual physical examination',
        comment: 'Fasting may be required for blood work'
      },
      'WALKIN': {
        display: 'A previously unscheduled walk-in visit',
        reasonCode: '185389009',
        reasonDisplay: 'Walk-in visit',
        reasonText: 'Walk-in appointment',
        description: 'Walk-in appointment for immediate care',
        comment: null
      }
    };

    const defaults = appointmentDefaults[appointmentType.toUpperCase()] || appointmentDefaults['CONSULTATION'];
    
    const appointment = {
      fullUrl: appointmentUuid,
      resource: {
        resourceType: 'Appointment',
        identifier: [{
          system: 'urn:redox:flow-ai:appointment',
          value: `appt-${new Date().toISOString().split('T')[0]}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
        }],
        status: 'booked',
        appointmentType: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
            code: appointmentType.toUpperCase(),
            display: defaults.display
          }]
        },
        reasonCode: [{
          coding: [{
            code: defaults.reasonCode,
            system: 'http://snomed.info/sct',
            display: defaults.reasonDisplay
          }],
          text: defaults.reasonText
        }],
        description: defaults.description,
        start: startTime,
        end: endTime,
        minutesDuration: Math.round((new Date(endTime) - new Date(startTime)) / 60000),
        participant: [{
          actor: {
            reference: `Patient/${patientId}`,
            display: `Patient ${patientId.split('-')[0]}`
          },
          required: 'required',
          status: 'accepted'
        }]
      }
    };

    // Add comment only if it exists
    if (defaults.comment) {
      appointment.resource.comment = defaults.comment;
    }

    return {
      resourceType: 'Bundle',
      id: `AppointmentCreateBundle-${appointmentType}`,
      type: 'message',
      timestamp: new Date().toISOString(),
      entry: [messageHeader, appointment]
    };
  }
}

module.exports = RedoxTransformer;
import { createOptOut } from "src/server/api/schema"; // TODO: need callable method

/**
 * Incoming message handler for classifying and processing optout requests
 */

export const processMessage = async messageInstance => {
  console.log(`message ${JSON.stringify(messageInstance, " ", 2)}`);

  // check if message content indicates an optout is requested
  if (isOptoutRequest(messageInstance)) {
    const optOut = {}; // TODO: contruct optOut object from inbound data
    const campaignContactId = null; // TODO: retrieve campaignId

    await createOptOut(optOut, campaignContactId);
    return false;
  }

  return true;
};

// Determine if the specified message is an optout request
// Content must be isolated "STOP" to avoid misinterpretation in context
// of a longer message response using similar text
function isOptoutRequest(messageInstance) {
  const content = messageInstance.text(); // FIXIT
  const optoutRegex = /^STOP$/;

  return optoutRegex.test(content);
}

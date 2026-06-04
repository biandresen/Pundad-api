import { matchedData } from "express-validator";
import emailService from "../services/emailService.js";

async function sendContactMessage(req, res, next) {
  const contactPayload = matchedData(req, { locations: ["body"] });
  const language = req.get("X-App-Language");

  try {
    await emailService.sendContactEmails(contactPayload, { language });

    return res.status(200).json({
      status: "success",
      message: "Contact message sent",
    });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("Failed to send contact message:", err);
    }

    return res.status(500).json({
      error: "Failed to send message",
    });
  }
}

export default {
  sendContactMessage,
};

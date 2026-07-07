import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { sanitizeQuery } from '../utils/sanitize';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
let genAI = null;
let isGeminiMock = true;

if (apiKey && apiKey !== "YOUR_GEMINI_API_KEY" && apiKey.trim() !== "") {
  genAI = new GoogleGenerativeAI(apiKey);
  isGeminiMock = false;
  console.log("Gemini API initialized successfully.");
} else {
  console.warn("Gemini API Key missing. Smart Bharat is running in Mock AI Mode.");
}

const SYSTEM_INSTRUCTION = `
You are "Smart Bharat", a GenAI-powered civic assistant developed to help Indian citizens with government services: Aadhaar update, ration card, birth certificate, water bill complaints, and road damage complaints.

Your task is to analyze the user's query and return a structured JSON response.

Follow these rules:
1. Detect if the user's query is in Hindi or English (or Hinglish - write the final response in Devanagari Hindi for Hindi/Hinglish queries, and in English for English queries).
2. Classify the query as:
   - "information": if the user is asking for information, procedure, list of documents, eligibility, etc.
   - "complaint": if the user is raising a specific complaint, reporting an issue (e.g. broken road, high water bill, water leak, garbage, pothole), or explicitly asking to file/register a complaint.
3. Identify the category: "Aadhaar update", "ration card", "birth certificate", "water bill complaint", "road damage complaint", or "other".
4. Generate the response field:
   - For "information" queries: Provide a warm, simplified explanation of the process AND a clear, bulleted list of "Required Documents" (आवश्यक दस्तावेज़) in the detected language.
   - For "complaint" queries: Provide a warm message acknowledging their issue, stating that you are registering it in the civic system, and explaining that a tracking ID will be generated. Do NOT include any actual tracking ID values in the response (the app will generate and show the exact ID).
5. For complaints, extract 'complaintDetails':
   - 'title': A short, clear summary (e.g. "Road damage near Sector 4" or "अत्यधिक पानी बिल की शिकायत").
   - 'description': A structured summary of the issue.

You MUST respond strictly in the following JSON format:
{
  "language": "English" | "Hindi",
  "classification": "information" | "complaint",
  "category": "Aadhaar update" | "ration card" | "birth certificate" | "water bill complaint" | "road damage complaint" | "other",
  "response": "string",
  "complaintDetails": {
    "title": "string",
    "description": "string"
  }
}
Do not include any markdown formatting wrappers like \`\`\`json. Return only the raw JSON string.
`;

// Mock helper for offline/no-key usage
const mockAnalyzeQuery = (query) => {
  const lowercaseQuery = query.toLowerCase();
  const isHindi = /क्या|कैसे|दस्तावेज़|कागज़|आधार|राशन|शिकायत|सड़क|पानी|बिल|जन्म|प्रमाण पत्र|टूटी|गड्ढा|पोटहोल/i.test(query);
  
  let category = "other";
  let classification = "information";
  let response = "";
  let title = "";
  let description = query;

  const isComplaint = /शिकायत|complaint|file|register|leak|damage|pothole|broken|problem|खराब|गड्ढा|टूटी|पानी का बिल|बदबू|कचरा/i.test(lowercaseQuery);
  if (isComplaint) {
    classification = "complaint";
  }

  if (/आधार|aadhaar|uidai/i.test(lowercaseQuery)) {
    category = "Aadhaar update";
  } else if (/राशन|ration/i.test(lowercaseQuery)) {
    category = "ration card";
  } else if (/जन्म|birth|certificate/i.test(lowercaseQuery)) {
    category = "birth certificate";
  } else if (/पानी|water|bill/i.test(lowercaseQuery)) {
    category = "water bill complaint";
  } else if (/सड़क|road|damage|pothole/i.test(lowercaseQuery)) {
    category = "road damage complaint";
  }

  if (isHindi) {
    title = classification === "complaint" ? `शिकायत: ${category}` : `जानकारी: ${category}`;
    if (classification === "complaint") {
      response = `आपकी शिकायत दर्ज कर ली गई है। हमारी टीम जल्द ही इस पर काम शुरू करेगी। कृपया अपना ट्रैकिंग आईडी सहेज कर रखें ताकि आप स्थिति की जांच कर सकें।`;
    } else {
      if (category === "Aadhaar update") {
        response = `आधार कार्ड में विवरण (नाम, पता, जन्म तिथि) अपडेट करने के लिए आप ऑनलाइन यूआईडीएआई (UIDAI) पोर्टल या नजदीकी आधार सेवा केंद्र पर जा सकते हैं।\n\n**आवश्यक दस्तावेज़:**\n- पहचान का प्रमाण (जैसे पैन कार्ड, वोटर आईडी, पासपोर्ट)\n- पते का प्रमाण (जैसे बिजली का बिल, बैंक पासबुक, राशन कार्ड)\n- जन्म तिथि का प्रमाण (जैसे जन्म प्रमाण पत्र, 10वीं की मार्कशीट)`;
      } else if (category === "ration card") {
        response = `नया राशन कार्ड बनवाने या उसमें संशोधन करने के लिए आपको अपने राज्य के खाद्य एवं नागरिक आपूर्ति विभाग के आधिकारिक पोर्टल पर ऑनलाइन आवेदन करना होगा।\n\n**आवश्यक दस्तावेज़:**\n- परिवार के सभी सदस्यों के आधार कार्ड की प्रतियां\n- परिवार के मुखिया की हालिया पासपोर्ट आकार की तस्वीर\n- पते का प्रमाण (जैसे बिजली का बिल, पानी का बिल)\n- आय प्रमाण पत्र`;
      } else if (category === "birth certificate") {
        response = `जन्म प्रमाण पत्र प्राप्त करने के लिए आपको बच्चे के जन्म के 21 दिनों के भीतर संबंधित नगर निगम या ग्राम पंचायत कार्यालय में पंजीकरण कराना होगा।\n\n**आवश्यक दस्तावेज़:**\n- अस्पताल द्वारा जारी डिस्चार्ज कार्ड/जन्म रिकॉर्ड\n- माता-पिता के पहचान पत्र (आधार कार्ड/वोटर आईडी)\n- माता-पिता का विवाह प्रमाण पत्र (यदि लागू हो)`;
      } else {
        response = `स्मार्ट भारत नागरिक सहायक में आपका स्वागत है। आपकी सेवा संबंधी जानकारी प्राप्त करने के लिए धन्यवाद।\n\n**आवश्यक दस्तावेज़:**\n- आधार कार्ड\n- निवास प्रमाण पत्र\n- हाल की पासपोर्ट फोटो`;
      }
    }
  } else {
    // English
    title = classification === "complaint" ? `Complaint: ${category}` : `Info: ${category}`;
    if (classification === "complaint") {
      response = `Your complaint regarding the selected service has been recorded in our civic action system. A tracking ID is being generated. You can use it to monitor the progress in the Tracking tab.`;
    } else {
      if (category === "Aadhaar update") {
        response = `To update your details (Name, Address, DOB, Gender, Mobile) on your Aadhaar card, you can use the official UIDAI online portal (for address updates) or visit an authorized Aadhaar Enrolment Centre.\n\n**Required Documents:**\n- **Proof of Identity (POI):** Passport, PAN Card, Voter ID, or Driving License\n- **Proof of Address (POA):** Electricity Bill, Water Bill, Bank Statement, or Rent Agreement\n- **Proof of Date of Birth (DoB):** Birth Certificate, Passport, or SSLC Book/Certificate`;
      } else if (category === "ration card") {
        response = `To apply for a new Ration Card or update details on an existing one, submit an application online through your state's Food & Civil Supplies portal or at the nearest Common Service Centre (CSC).\n\n**Required Documents:**\n- Aadhaar Cards of all family members\n- Passport size photograph of the Head of the Family\n- Income Certificate\n- Proof of residence (Electricity bill, gas connection card, or rent agreement)`;
      } else if (category === "birth certificate") {
        response = `To register a birth and obtain a Birth Certificate, you must file an application with the local Registrar (Municipal Corporation in urban areas, Gram Panchayat in rural areas) within 21 days of birth.\n\n**Required Documents:**\n- Discharge certificate or birth record slip from the hospital\n- Aadhaar Cards/Identity proofs of both parents\n- Address proof of the parents`;
      } else {
        response = `Welcome to Smart Bharat Civic Assistant. Here is the general procedure for your request.\n\n**Required Documents:**\n- Aadhaar Card\n- Address Proof\n- Recent Passport size photograph`;
      }
    }
  }

  return {
    language: isHindi ? "Hindi" : "English",
    classification,
    category,
    response,
    complaintDetails: {
      title,
      description
    }
  };
};

/** Gemini safety settings — block medium-and-above harmful content. */
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

/**
 * Validate the parsed Gemini response has the expected shape.
 * Returns a safe default if the schema is unexpected.
 */
function validateResponse(parsed, originalQuery) {
  const validClassifications = ['information', 'complaint'];
  const validLanguages = ['Hindi', 'English'];
  const validCategories = ['Aadhaar update', 'ration card', 'birth certificate', 'water bill complaint', 'road damage complaint', 'other'];

  if (!parsed || typeof parsed !== 'object') return null;
  if (!validClassifications.includes(parsed.classification)) return null;
  if (typeof parsed.response !== 'string' || parsed.response.length === 0) return null;

  // Coerce fields to valid values
  if (!validLanguages.includes(parsed.language)) parsed.language = 'English';
  if (!validCategories.includes(parsed.category)) parsed.category = 'other';

  // Ensure complaintDetails exists for complaints
  if (parsed.classification === 'complaint') {
    if (!parsed.complaintDetails || typeof parsed.complaintDetails !== 'object') {
      parsed.complaintDetails = { title: `Complaint: ${parsed.category}`, description: originalQuery };
    }
  }

  return parsed;
}

export async function analyzeQuery(query) {
  // Sanitize user input before processing
  const { valid, sanitized, error } = sanitizeQuery(query);
  if (!valid) {
    // Return a mock error response if input is invalid
    return {
      language: 'English',
      classification: 'information',
      category: 'other',
      response: error || 'Invalid input. Please try again with a valid message.',
      complaintDetails: { title: '', description: '' }
    };
  }

  if (isGeminiMock) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return mockAnalyzeQuery(sanitized);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      safetySettings,
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const result = await model.generateContent(sanitized);
    const text = result.response.text();
    // Only log response length in production, not the full content
    console.debug(`Gemini response received (${text.length} chars)`);
    const parsed = JSON.parse(text);
    const validated = validateResponse(parsed, sanitized);

    if (!validated) {
      console.warn('Gemini response failed schema validation, falling back to local analyzer.');
      return mockAnalyzeQuery(sanitized);
    }

    return validated;
  } catch (error) {
    console.error("Gemini API error, falling back to local analyzer:", error.message);
    return mockAnalyzeQuery(sanitized);
  }
}
export { isGeminiMock };

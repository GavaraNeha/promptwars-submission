import { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Search, 
  FileText, 
  Send, 
  Copy, 
  Check, 
  Loader2, 
  Building, 
  AlertCircle, 
  ArrowRight,
  ClipboardList,
  Flame,
  Globe
} from 'lucide-react';
import { db, isMock } from './config/firebase';
import { analyzeQuery } from './config/gemini';
import { generateTrackingId, parseMarkdown } from './utils/helpers';
import { sanitizeQuery, sanitizeTrackingId, sanitizeForFirestore } from './utils/sanitize';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from 'firebase/firestore';

/**
 * Renders parsed markdown lines from helpers.parseMarkdown as JSX.
 * Keeps JSX-specific rendering here while pure parsing logic lives in helpers.js.
 */
const renderMessageText = (text) => {
  if (!text) return null;

  return parseMarkdown(text).map((line, lineIdx) => {
    // Convert segments array to JSX spans
    const parts = line.segments.map((seg, segIdx) =>
      seg.bold
        ? <strong key={segIdx}>{seg.text}</strong>
        : <span key={segIdx}>{seg.text}</span>
    );

    if (line.type === 'bullet') {
      return (
        <div key={lineIdx} style={{ paddingLeft: `${(line.indent * 0.5) + 1.25}rem`, textIndent: '-0.85rem', marginBottom: '0.35rem' }}>
          <span style={{ color: 'var(--accent-saffron)', marginRight: '0.35rem', fontWeight: 'bold' }}>•</span>
          {parts}
        </div>
      );
    }

    if (line.type === 'numbered') {
      return (
        <div key={lineIdx} style={{ paddingLeft: `${(line.indent * 0.5) + 1.5}rem`, textIndent: '-1.1rem', marginBottom: '0.35rem' }}>
          <span style={{ color: 'var(--secondary-color)', fontWeight: '700', marginRight: '0.35rem' }}>{line.numPrefix}</span>
          {parts}
        </div>
      );
    }

    const rawLine = line.segments.map(s => s.text).join('');
    return (
      <div key={lineIdx} style={{ minHeight: rawLine.trim() === '' ? '0.75rem' : 'auto', marginBottom: '0.35rem' }}>
        {parts}
      </div>
    );
  });
};

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "नमस्ते! मैं स्मार्ट भारत नागरिक सहायक हूँ। मैं आधार अपडेट, राशन कार्ड, जन्म प्रमाण पत्र जैसी सरकारी सेवाओं के बारे में जानकारी देने या आपकी शिकायत दर्ज करने में मदद कर सकता हूँ। आप हिंदी या अंग्रेजी में लिख सकते हैं।\n\nHello! I am the Smart Bharat Civic Assistant. I can help you with information about government services (Aadhaar, Ration Card, Birth Certificate) or register a civic complaint (Water bill, road damage). You can type in Hindi or English.",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchId, setSearchId] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [copySuccessId, setCopySuccessId] = useState(null);

  const messagesEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Handle copying tracking ID
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopySuccessId(text);
    setTimeout(() => setCopySuccessId(null), 2000);
  };

  // generateTrackingId is imported from src/utils/helpers.js

  // Client-side rate limiting: minimum 2-second gap between sends
  const lastSendTimeRef = useRef(0);
  const SEND_COOLDOWN_MS = 2000;

  // Send message handler
  const handleSendMessage = async (textToSend) => {
    const rawText = textToSend || inputValue;
    if (!rawText.trim()) return;

    // Rate limiting: prevent rapid-fire sends
    const now = Date.now();
    if (now - lastSendTimeRef.current < SEND_COOLDOWN_MS) return;
    lastSendTimeRef.current = now;

    // Reset input
    if (!textToSend) setInputValue('');

    // Input validation (sanitizeQuery strips HTML, control chars, enforces length)
    const { valid, sanitized: text, error: sanitizeError } = sanitizeQuery(rawText);
    if (!valid) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'assistant',
        text: sanitizeError || 'Your message could not be processed. Please try again.',
        timestamp: new Date()
      }]);
      return;
    }

    const userMessageId = Date.now().toString();
    const newUserMessage = {
      id: userMessageId,
      sender: 'user',
      text: text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    try {
      // Analyze with Gemini (query is already sanitized inside analyzeQuery too)
      const analysis = await analyzeQuery(text);
      const trackingId = analysis.classification === 'complaint' ? generateTrackingId() : null;

      let complaintSaved = false;

      if (analysis.classification === 'complaint') {
        // Sanitize all fields before writing to Firestore / localStorage
        const title = sanitizeForFirestore(
          analysis.complaintDetails?.title || `Complaint: ${analysis.category}`, 200
        );
        const description = sanitizeForFirestore(
          analysis.complaintDetails?.description || text, 2000
        );
        const category = sanitizeForFirestore(analysis.category, 50);
        const language = analysis.language === 'Hindi' ? 'Hindi' : 'English';

        if (isMock) {
          const localComplaints = JSON.parse(localStorage.getItem('smart_bharat_complaints') || '[]');
          const newComplaint = {
            trackingId,
            query: sanitizeForFirestore(text, 1000),
            title,
            description,
            category,
            language,
            status: 'Submitted',
            createdAt: new Date().toISOString()
          };
          localComplaints.push(newComplaint);
          localStorage.setItem('smart_bharat_complaints', JSON.stringify(localComplaints));
          complaintSaved = true;
        } else {
          const ticketRef = doc(db, 'complaints', trackingId);
          await setDoc(ticketRef, {
            trackingId,
            query: sanitizeForFirestore(text, 1000),
            title,
            description,
            category,
            language,
            status: 'Submitted',
            createdAt: serverTimestamp()
          });
          complaintSaved = true;
        }
      }

      // Create assistant reply
      let responseText = analysis.response;
      
      if (analysis.classification === 'complaint' && complaintSaved) {
        if (analysis.language === 'Hindi') {
          responseText += `\n\nआपकी शिकायत का ट्रैकिंग आईडी (Tracking ID) है: **${trackingId}**।\nआप "शिकायत ट्रैक करें" (Track Complaint) टैब में जाकर इस आईडी के माध्यम से अपनी शिकायत की स्थिति देख सकते हैं।`;
        } else {
          responseText += `\n\nYour complaint has been successfully registered. Your Tracking ID is: **${trackingId}**.\nYou can use this ID to check the status under the "Track Complaint" tab.`;
        }
      }

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'assistant',
        text: responseText,
        timestamp: new Date(),
        classification: analysis.classification,
        category: analysis.category,
        trackingId: trackingId,
        language: analysis.language
      }]);

    } catch (error) {
      console.error("Error processing message:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'assistant',
        text: "I apologize, but I encountered an error while processing your request. Please try again.\n\nक्षमा करें, आपके अनुरोध को संसाधित करते समय एक त्रुटि हुई। कृपया पुन: प्रयास करें।",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Search tracking ID
  const handleSearchComplaint = async (e) => {
    if (e) e.preventDefault();
    if (!searchId.trim()) return;

    setSearchLoading(true);
    setSearchError('');
    setSearchResult(null);

    // Validate tracking ID format before querying
    const { valid, trackingId: targetId, error: idError } = sanitizeTrackingId(searchId);
    if (!valid) {
      setSearchError(idError);
      setSearchLoading(false);
      return;
    }

    try {
      if (isMock) {
        const localComplaints = JSON.parse(localStorage.getItem('smart_bharat_complaints') || '[]');
        const found = localComplaints.find(c => c.trackingId.toUpperCase() === targetId);
        
        if (found) {
          setSearchResult(found);
        } else {
          setSearchError('No complaint found with this Tracking ID. / \u0907\u0938 \u091F\u094D\u0930\u0948\u0915\u093F\u0902\u0917 \u0906\u0908\u0921\u0940 \u0915\u0947 \u0938\u093E\u0925 \u0915\u094B\u0908 \u0936\u093F\u0915\u093E\u092F\u0924 \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u0940\u0964');
        }
      } else {
        // Fetch from Firestore — targetId is already validated as SB-XXXXXX
        const docRef = doc(db, 'complaints', targetId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString();
          setSearchResult({
            ...data,
            createdAt: dateStr
          });
        } else {
          // Fallback: search by field in case doc ID doesn't match
          const q = query(collection(db, 'complaints'), where('trackingId', '==', targetId));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const data = querySnapshot.docs[0].data();
            const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString();
            setSearchResult({
              ...data,
              createdAt: dateStr
            });
          } else {
            setSearchError('No complaint found with this Tracking ID. / \u0907\u0938 \u091F\u094D\u0930\u0948\u0915\u093F\u0902\u0917 \u0906\u0908\u0921\u0940 \u0915\u0947 \u0938\u093E\u0925 \u0915\u094B\u0908 \u0936\u093F\u0915\u093E\u092F\u0924 \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u0940\u0964');
          }
        }
      }
    } catch (err) {
      console.error("Search error:", err.message);
      setSearchError('Failed to search complaint. Please check your network. / \u0936\u093F\u0915\u093E\u092F\u0924 \u0916\u094B\u091C\u0928\u0947 \u092E\u0947\u0902 \u0935\u093F\u092B\u0932\u0964 \u0915\u0943\u092A\u092F\u093E \u0905\u092A\u0928\u093E \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u091C\u093E\u0902\u091A\u0947\u0902\u0964');
    } finally {
      setSearchLoading(false);
    }
  };

  // Status progression tool for Mock Mode evaluations
  const handleUpdateStatus = (newStatus) => {
    if (!searchResult) return;
    
    const updated = { ...searchResult, status: newStatus };
    setSearchResult(updated);

    if (isMock) {
      const localComplaints = JSON.parse(localStorage.getItem('smart_bharat_complaints') || '[]');
      const index = localComplaints.findIndex(c => c.trackingId.toUpperCase() === searchResult.trackingId.toUpperCase());
      if (index !== -1) {
        localComplaints[index].status = newStatus;
        localStorage.setItem('smart_bharat_complaints', JSON.stringify(localComplaints));
      }
    } else {
      // Update in Firestore
      const docRef = doc(db, 'complaints', searchResult.trackingId.toUpperCase());
      setDoc(docRef, { status: newStatus }, { merge: true }).catch(console.error);
    }
  };

  // Quick prompt chips
  const quickPrompts = [
    { text: "Aadhaar Card update documents", icon: "📇" },
    { text: "आधार सुधार के दस्तावेज़", icon: "📇" },
    { text: "Ration card process", icon: "🌾" },
    { text: "File road damage complaint", icon: "🛣️" },
    { text: "पानी का बिल बहुत ज़्यादा आया है", icon: "💧" }
  ];

  // Services Directory Data
  const servicesList = [
    {
      title: "Aadhaar Card (आधार कार्ड)",
      subtitle: "UIDAI Civic Identity",
      desc: "Information regarding updating your demographic details (Name, Address, DOB, Gender, Mobile Number) or biometric data.",
      docs: ["Proof of Identity (PAN, Passport)", "Proof of Address (Electricity bill, Bank passbook)", "Date of Birth proof"],
      icon: "📇"
    },
    {
      title: "Ration Card (राशन कार्ड)",
      subtitle: "Food Security & Supplies",
      desc: "Apply for a new Ration Card or update existing household member information under your state food supplies portal.",
      docs: ["Aadhaar cards of all members", "Passport size photo of Head of Family", "Income Certificate", "Residence proof"],
      icon: "🌾"
    },
    {
      title: "Birth Certificate (जन्म प्रमाण पत्र)",
      subtitle: "Registrar of Births & Deaths",
      desc: "Register a child's birth within 21 days at the municipal office or Panchayat block to obtain the legal certificate.",
      docs: ["Hospital birth record slip", "Parents' Identity proofs (Aadhaar/Voter ID)", "Address proof of parents"],
      icon: "👶"
    },
    {
      title: "Water Services (जल आपूर्ति और शिकायत)",
      subtitle: "Municipal Water Board",
      desc: "File complaints regarding pipe leakage, contaminated water supply, sewage problems, or incorrect billing calculations.",
      docs: ["Previous water bill", "Consumer Connection ID", "Photo of damage/leakage (optional)"],
      icon: "💧"
    },
    {
      title: "Roads & Infrastructure (सड़क एवं बुनियादी ढांचा)",
      subtitle: "Public Works Department (PWD)",
      desc: "File immediate complaints regarding severe potholes, broken pavement, street light failures, or drainage overflow on public roads.",
      docs: ["Location coordinates/Address", "Photos of road damage", "Citizen ID Proof"],
      icon: "🛣️"
    }
  ];

  return (
    <>
      {/* Mock Mode Alert Banner */}
      {isMock && (
        <div className="mock-banner" role="status" aria-live="polite">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            <strong>Demo Mode:</strong> Firebase configuration is not set. Saving complaints to Local Browser Storage. Set up <code>.env</code> file for live Firestore syncing.
          </span>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="brand-container">
          <div className="logo-icon">SB</div>
          <div className="brand-details">
            <h1>
              स्मार्ट भारत <span className="brand-tag">Smart Bharat</span>
            </h1>
            <p className="brand-subtitle">AI-Powered Civic Assistant & Digital Complaint Desk</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#64748b' }}>
          <Globe size={16} />
          <span>English & हिन्दी Support</span>
        </div>
      </header>

      {/* Main Area */}
      <main className="main-container">
        {/* Navigation Tabs */}
        <nav className="navigation-tabs" role="tablist" aria-label="Main sections">
          <button
            role="tab"
            aria-selected={activeTab === 'chat'}
            aria-controls="panel-chat"
            id="tab-chat"
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={18} aria-hidden="true" />
            <span>सहायक (Chat Assistant)</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'track'}
            aria-controls="panel-track"
            id="tab-track"
            className={`tab-btn ${activeTab === 'track' ? 'active' : ''}`}
            onClick={() => setActiveTab('track')}
          >
            <Search size={18} aria-hidden="true" />
            <span>शिकायत ट्रैक करें (Track Complaint)</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'directory'}
            aria-controls="panel-directory"
            id="tab-directory"
            className={`tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => setActiveTab('directory')}
          >
            <FileText size={18} aria-hidden="true" />
            <span>सेवा निर्देशिका (Services Info)</span>
          </button>
        </nav>

        {/* Tab Contents */}
        <div className="tab-content">
          {activeTab === 'chat' && (
            <div
              className="card chat-container"
              id="panel-chat"
              role="tabpanel"
              aria-labelledby="tab-chat"
            >
              <div className="chat-header">
                <div className="chat-header-info">
                  <div className="chat-header-avatar" aria-hidden="true">🤖</div>
                  <div className="chat-header-text">
                    <h2>Smart Bharat AI</h2>
                    <p>Active to assist you • 24x7</p>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                  Gemini API Classified
                </div>
              </div>

              {/* Message List — role=log announces new messages to screen readers */}
              <div
                className="chat-messages"
                role="log"
                aria-label="Chat conversation"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-wrapper ${msg.sender}`}
                    role={msg.sender === 'assistant' ? 'article' : undefined}
                    aria-label={msg.sender === 'assistant' ? 'Smart Bharat AI response' : 'Your message'}
                  >
                    <div className="message-bubble">
                      {renderMessageText(msg.text)}

                      {/* Render copyable tracking ID if available */}
                      {msg.trackingId && (
                        <div className="complaint-card">
                          <div className="complaint-ticket-header">
                            <span>COMPLAINT REGISTERED</span>
                            <button
                              className="ticket-id-badge"
                              onClick={() => copyToClipboard(msg.trackingId)}
                              aria-label={copySuccessId === msg.trackingId ? `Tracking ID ${msg.trackingId} copied` : `Copy tracking ID ${msg.trackingId}`}
                            >
                              {msg.trackingId}
                              {copySuccessId === msg.trackingId ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                            </button>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Category: {msg.category}</span>
                            <button
                              onClick={() => {
                                setSearchId(msg.trackingId);
                                setActiveTab('track');
                                setTimeout(() => {
                                  const searchForm = document.getElementById('search-form');
                                  if (searchForm) searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                                }, 100);
                              }}
                              aria-label={`Track progress for complaint ${msg.trackingId}`}
                              style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', padding: 0 }}
                            >
                              Track Progress <ArrowRight size={12} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}

                {isLoading && (
                  <div
                    className="typing-indicator"
                    role="status"
                    aria-label="Smart Bharat AI is thinking"
                  >
                    <div className="typing-dot" aria-hidden="true"></div>
                    <div className="typing-dot" aria-hidden="true"></div>
                    <div className="typing-dot" aria-hidden="true"></div>
                    <span className="sr-only">AI is typing a response…</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggestions */}
              <div
                className="quick-prompts-container"
                role="group"
                aria-label="Quick query suggestions"
              >
                {quickPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="quick-prompt-tag"
                    onClick={() => handleSendMessage(prompt.text)}
                    disabled={isLoading}
                    aria-label={`Send suggestion: ${prompt.text}`}
                  >
                    <span aria-hidden="true">{prompt.icon}</span>
                    <span>{prompt.text}</span>
                  </button>
                ))}
              </div>

              {/* Chat Input */}
              <div className="chat-input-bar" role="form" aria-label="Send a message">
                <div className="chat-input-wrapper">
                  <label htmlFor="chat-input" className="sr-only">
                    Type your query in English or Hindi
                  </label>
                  <input
                    id="chat-input"
                    type="text"
                    className="chat-input"
                    placeholder="Type your query… (e.g. 'How do I update my Aadhaar?' or 'सड़क टूटने की शिकायत दर्ज करें')"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendMessage();
                    }}
                    disabled={isLoading}
                    aria-label="Chat message input — type in English or Hindi"
                    aria-describedby="chat-hint"
                  />
                  <span id="chat-hint" className="sr-only">
                    Press Enter or the Send button to submit your query. You can write in English or Hindi.
                  </span>
                </div>
                <button
                  className="send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !inputValue.trim()}
                  aria-label={isLoading ? 'Sending message, please wait' : 'Send message'}
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'track' && (
            <div
              className="card tracker-card"
              id="panel-track"
              role="tabpanel"
              aria-labelledby="tab-track"
            >
              <div className="tracker-title-section">
                <h2>शिकायत की स्थिति जांचें • Track Complaint Status</h2>
                <p>Enter your 6-character Tracking ID (e.g. SB-XXXXXX) to view status in real time.</p>
              </div>

              <form id="search-form" className="search-box" onSubmit={handleSearchComplaint} aria-label="Search complaint by tracking ID">
                <label htmlFor="search-input" className="sr-only">Enter your Complaint Tracking ID</label>
                <input
                  id="search-input"
                  type="text"
                  placeholder="Enter Tracking ID (e.g., SB-8A2D7P)"
                  className="search-input"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  aria-label="Complaint tracking ID"
                  aria-describedby="search-hint"
                />
                <span id="search-hint" className="sr-only">Format: SB- followed by 6 uppercase letters and numbers</span>
                <button type="submit" className="search-btn" disabled={searchLoading} aria-label={searchLoading ? 'Searching, please wait' : 'Search for complaint status'}>
                  {searchLoading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
                  <span>खोजें (Search)</span>
                </button>
              </form>

              {searchError && (
                <div className="not-found-box" role="alert">
                  <AlertCircle size={40} style={{ color: '#ef4444', marginBottom: '1rem' }} aria-hidden="true" />
                  <p>{searchError}</p>
                </div>
              )}

              {searchResult && (
                <div className="ticket-details-box">
                  <div className="details-header">
                    <div>
                      <h3>{searchResult.title}</h3>
                      <p className="details-date">
                        Filed on: {new Date(searchResult.createdAt).toLocaleDateString()} at {new Date(searchResult.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    </div>
                    <span className={`status-badge ${searchResult.status.toLowerCase()}`}>
                      {searchResult.status}
                    </span>
                  </div>

                  <div className="details-body">
                    {/* Status timeline */}
                    <div
                      className="timeline-tracker"
                      role="list"
                      aria-label={`Complaint status: ${searchResult.status}`}
                    >
                      <div
                        role="listitem"
                        className={`timeline-step ${searchResult.status === 'Submitted' || searchResult.status === 'Reviewing' || searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Submitted' ? 'active' : ''}`}
                        aria-current={searchResult.status === 'Submitted' ? 'step' : undefined}
                      >
                        <div className="step-bubble" aria-hidden="true">1</div>
                        <span className="step-label">Submitted</span>
                      </div>
                      <div
                        role="listitem"
                        className={`timeline-step ${searchResult.status === 'Reviewing' || searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Reviewing' ? 'active' : ''}`}
                        aria-current={searchResult.status === 'Reviewing' ? 'step' : undefined}
                      >
                        <div className="step-bubble" aria-hidden="true">2</div>
                        <span className="step-label">Reviewing</span>
                      </div>
                      <div
                        role="listitem"
                        className={`timeline-step ${searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Resolved' ? 'active' : ''}`}
                        aria-current={searchResult.status === 'Resolved' ? 'step' : undefined}
                      >
                        <div className="step-bubble" aria-hidden="true">3</div>
                        <span className="step-label">Resolved</span>
                      </div>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Tracking ID</span>
                      <span className="detail-val" style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem', color: '#1e3a8a' }}>
                        {searchResult.trackingId}
                      </span>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Service Type / श्रेणी</span>
                      <span className="detail-val" style={{ textTransform: 'capitalize' }}>
                        {searchResult.category}
                      </span>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Issue Details / शिकायत विवरण</span>
                      <span className="detail-val">{searchResult.description}</span>
                    </div>

                    {/* Developer Evaluator Utility for testing */}
                    <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px dashed #cbd5e1', borderRadius: '8px', background: '#f8fafc' }}>
                      <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <ClipboardList size={14} /> EVALUATOR TOOL: Change Ticket Status
                      </h4>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="tab-btn"
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => handleUpdateStatus('Submitted')}
                          aria-label={`Set complaint ${searchResult.trackingId} status to Submitted`}
                        >
                          Mark Submitted
                        </button>
                        <button
                          className="tab-btn"
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => handleUpdateStatus('Reviewing')}
                          aria-label={`Set complaint ${searchResult.trackingId} status to Reviewing`}
                        >
                          Mark Reviewing
                        </button>
                        <button
                          className="tab-btn"
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => handleUpdateStatus('Resolved')}
                          aria-label={`Set complaint ${searchResult.trackingId} status to Resolved`}
                        >
                          Mark Resolved
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'directory' && (
            <div
              className="card"
              style={{ padding: '2rem' }}
              id="panel-directory"
              role="tabpanel"
              aria-labelledby="tab-directory"
            >
              <div className="tracker-title-section">
                <h2>नागरिक सेवा निर्देशिका • Service Directory</h2>
                <p>Quick lookup guide for required documents and steps for common Indian civic services.</p>
              </div>

              <div className="directory-grid">
                {servicesList.map((svc, idx) => (
                  <div key={idx} className="directory-card" aria-label={`Service: ${svc.title}`}>
                    <div className="directory-card-header">
                      <div className="directory-card-icon" style={{ fontSize: '1.5rem' }} aria-hidden="true">{svc.icon}</div>
                      <div className="directory-card-title">
                        <h3>{svc.title}</h3>
                        <p>{svc.subtitle}</p>
                      </div>
                    </div>
                    <p className="directory-card-desc">{svc.desc}</p>
                    <div className="doc-badge-container">
                      {svc.docs.map((docItem, dIdx) => (
                        <span key={dIdx} className="doc-badge">{docItem}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 Smart Bharat. GenAI civic services powered by Google Gemini API & Firestore.</p>
        <p style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>Designed for rapid local governance and citizen accessibility.</p>
      </footer>
    </>
  );
}

export default App;

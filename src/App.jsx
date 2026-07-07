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

  // Send message handler
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputValue;
    if (!text.trim()) return;

    // Reset input
    if (!textToSend) setInputValue('');

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
      // Analyze with Gemini
      const analysis = await analyzeQuery(text);
      const trackingId = analysis.classification === 'complaint' ? generateTrackingId() : null;

      let complaintSaved = false;

      if (analysis.classification === 'complaint') {
        const title = analysis.complaintDetails?.title || `Complaint: ${analysis.category}`;
        const description = analysis.complaintDetails?.description || text;
        const category = analysis.category;
        const language = analysis.language || 'English';

        if (isMock) {
          // Save to local storage
          const localComplaints = JSON.parse(localStorage.getItem('smart_bharat_complaints') || '[]');
          const newComplaint = {
            trackingId,
            query: text,
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
          // Save to Firestore
          const ticketRef = doc(db, 'complaints', trackingId);
          await setDoc(ticketRef, {
            trackingId,
            query: text,
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

    const targetId = searchId.toUpperCase().trim();

    try {
      if (isMock) {
        // Fetch from LocalStorage
        const localComplaints = JSON.parse(localStorage.getItem('smart_bharat_complaints') || '[]');
        const found = localComplaints.find(c => c.trackingId.toUpperCase() === targetId);
        
        if (found) {
          setSearchResult(found);
        } else {
          setSearchError('No complaint found with this Tracking ID. / इस ट्रैकिंग आईडी के साथ कोई शिकायत नहीं मिली।');
        }
      } else {
        // Fetch from Firestore
        const docRef = doc(db, 'complaints', targetId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          // Map firestore timestamp to readable string
          const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString();
          setSearchResult({
            ...data,
            createdAt: dateStr
          });
        } else {
          // Try search by query filter just in case doc ID doesn't match
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
            setSearchError('No complaint found with this Tracking ID. / इस ट्रैकिंग आईडी के साथ कोई शिकायत नहीं मिली।');
          }
        }
      }
    } catch (err) {
      console.error("Search error:", err);
      setSearchError('Failed to search complaint. Please check your network. / शिकायत खोजने में विफल। कृपया अपना नेटवर्क जांचें।');
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
        <div className="mock-banner">
          <AlertCircle size={16} />
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
        <nav className="navigation-tabs">
          <button 
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={18} />
            <span>सहायक (Chat Assistant)</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'track' ? 'active' : ''}`}
            onClick={() => setActiveTab('track')}
          >
            <Search size={18} />
            <span>शिकायत ट्रैक करें (Track Complaint)</span>
          </button>
          <button 
            className={`tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => setActiveTab('directory')}
          >
            <FileText size={18} />
            <span>सेवा निर्देशिका (Services Info)</span>
          </button>
        </nav>

        {/* Tab Contents */}
        <div className="tab-content">
          {activeTab === 'chat' && (
            <div className="card chat-container">
              <div className="chat-header">
                <div className="chat-header-info">
                  <div className="chat-header-avatar">🤖</div>
                  <div className="chat-header-text">
                    <h2>Smart Bharat AI</h2>
                    <p>Active to assist you • 24x7</p>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                  Gemini API Classified
                </div>
              </div>

              {/* Message List */}
              <div className="chat-messages">
                {messages.map((msg) => (
                  <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
                    <div className="message-bubble">
                      {renderMessageText(msg.text)}

                      {/* Render copyable tracking ID if available */}
                      {msg.trackingId && (
                        <div className="complaint-card">
                          <div className="complaint-ticket-header">
                            <span>COMPLAINT REGISTERED</span>
                            <span 
                              className="ticket-id-badge" 
                              onClick={() => copyToClipboard(msg.trackingId)}
                              title="Click to copy ID"
                            >
                              {msg.trackingId}
                              {copySuccessId === msg.trackingId ? <Check size={14} /> : <Copy size={14} />}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Category: {msg.category}</span>
                            <button
                              onClick={() => {
                                setSearchId(msg.trackingId);
                                setActiveTab('track');
                                // Trigger search in microtask
                                setTimeout(() => {
                                  const searchForm = document.getElementById('search-form');
                                  if (searchForm) searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                                }, 100);
                              }}
                              style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', padding: 0 }}
                            >
                              Track Progress <ArrowRight size={12} />
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
                  <div className="typing-indicator">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggestions */}
              <div className="quick-prompts-container">
                {quickPrompts.map((prompt, idx) => (
                  <button 
                    key={idx} 
                    className="quick-prompt-tag"
                    onClick={() => handleSendMessage(prompt.text)}
                    disabled={isLoading}
                  >
                    <span>{prompt.icon}</span>
                    <span>{prompt.text}</span>
                  </button>
                ))}
              </div>

              {/* Chat Input */}
              <div className="chat-input-bar">
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="Type your query... (e.g. 'How do I update my Aadhaar?' or 'सड़क टूटने की शिकायत दर्ज करें')"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendMessage();
                    }}
                    disabled={isLoading}
                  />
                </div>
                <button 
                  className="send-btn" 
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !inputValue.trim()}
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'track' && (
            <div className="card tracker-card">
              <div className="tracker-title-section">
                <h2>शिकायत की स्थिति जांचें • Track Complaint Status</h2>
                <p>Enter your 6-character Tracking ID (e.g. SB-XXXXXX) to view status in real time.</p>
              </div>

              <form id="search-form" className="search-box" onSubmit={handleSearchComplaint}>
                <input
                  type="text"
                  placeholder="Enter Tracking ID (e.g., SB-8A2D7P)"
                  className="search-input"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                />
                <button type="submit" className="search-btn" disabled={searchLoading}>
                  {searchLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                  <span>खोजें (Search)</span>
                </button>
              </form>

              {searchError && (
                <div className="not-found-box">
                  <AlertCircle size={40} style={{ color: '#ef4444', marginBottom: '1rem' }} />
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
                    <div className="timeline-tracker">
                      <div className={`timeline-step ${searchResult.status === 'Submitted' || searchResult.status === 'Reviewing' || searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Submitted' ? 'active' : ''}`}>
                        <div className="step-bubble">1</div>
                        <span className="step-label">Submitted</span>
                      </div>
                      <div className={`timeline-step ${searchResult.status === 'Reviewing' || searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Reviewing' ? 'active' : ''}`}>
                        <div className="step-bubble">2</div>
                        <span className="step-label">Reviewing</span>
                      </div>
                      <div className={`timeline-step ${searchResult.status === 'Resolved' ? 'completed' : ''} ${searchResult.status === 'Resolved' ? 'active' : ''}`}>
                        <div className="step-bubble">3</div>
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
                        >
                          Mark Submitted
                        </button>
                        <button 
                          className="tab-btn" 
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => handleUpdateStatus('Reviewing')}
                        >
                          Mark Reviewing
                        </button>
                        <button 
                          className="tab-btn" 
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
                          onClick={() => handleUpdateStatus('Resolved')}
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
            <div className="card" style={{ padding: '2rem' }}>
              <div className="tracker-title-section">
                <h2>नागरिक सेवा निर्देशिका • Service Directory</h2>
                <p>Quick lookup guide for required documents and steps for common Indian civic services.</p>
              </div>

              <div className="directory-grid">
                {servicesList.map((svc, idx) => (
                  <div key={idx} className="directory-card">
                    <div className="directory-card-header">
                      <div className="directory-card-icon" style={{ fontSize: '1.5rem' }}>{svc.icon}</div>
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

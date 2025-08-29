// pages/index.js
import Head from 'next/head'
import Link from 'next/link'
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function Home() {
  return (
    <>
      <Head>
        <title>optiMenu Solutions - Turn Your Restaurant Data Into Profit</title>
        <meta name="description" content="AI-powered insights that show you exactly what each dish costs to make, what to push each day, and how to eliminate food waste." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Header */}
      <header className="header">
        <nav className="nav">
          <Link href="/" className="logo">
            <img src="/optimenu-logo.png" alt="optiMenu Solutions" className="logo-img" />
          </Link>
          <ul className="nav-links">
            <li><Link href="#platform">Platform</Link></li>
            <li><Link href="#features">Features</Link></li>
            <li><Link href="#pricing">Pricing</Link></li>
            <li><Link href="#contact">Contact</Link></li>
          </ul>
          <div className="nav-actions">
            <Link href="/client/login" className="btn btn-secondary">
              Login
            </Link>
            <Link href="/client" className="btn btn-primary">
              Start Free Trial
            </Link>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Hero Section */}
        <section className="hero">
          <div className="hero-container">
            <div className="hero-content">
              <div className="hero-text">
                <h1 className="hero-title">
                  <span className="title-line">Let your kitchen data</span>
                  <span className="title-line">drive <span className="title-highlight green">profits</span></span>
                  
                </h1>
                <p className="hero-description">
                  AI-powered insights that show you exactly what each dish costs to make, what to push each day, and how to eliminate food waste—all in one comprehensive dashboard.
                </p>
                <div className="hero-actions">
                  <Link href="/client" className="btn btn-hero btn-primary">
                    Start Free Trial
                  </Link>
                  <Link href="#platform" className="btn btn-hero btn-outline">
                    View Platform
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trusted By Section */}
        <section className="trusted-by">
          <div className="container">
            <div className="trusted-by-content">
              <p className="trusted-by-text">TRUSTED BY RESTAURANTS NATIONWIDE</p>
              <div className="trusted-by-logos">
                <div className="logo-placeholder">Fine Dining Group</div>
                <div className="logo-placeholder">Metro Restaurants</div>
                <div className="logo-placeholder">Coastal Kitchen Co.</div>
                <div className="logo-placeholder">Urban Eats</div>
                <div className="logo-placeholder">Garden Fresh Bistro</div>
              </div>
            </div>
          </div>
        </section>

        {/* Platform Section */}
        <section id="platform" className="platform">
          <div className="container">
            <div className="platform-content">
              <div className="section-header">
                <div className="section-tag">PLATFORM</div>
                <h2>Restaurant Intelligence Platform</h2>
                <p className="section-description">Comprehensive cost tracking and profit optimization for your entire operation</p>
              </div>
              <div className="platform-grid">
                <div className="platform-card">
                  <div className="platform-card-content">
                    <h3>Real-time cost tracking and profit optimization for your entire menu</h3>
                    <p>Monitor ingredient costs, track margins, and receive actionable insights to maximize profitability across all menu items.</p>
                  </div>
                  <div className="platform-image">
                    <div className="dashboard-preview">
                      <div className="dashboard-header">
                        <div className="dashboard-title">optiMenu Dashboard</div>
                        <div className="dashboard-metrics">
                          <div className="metric">
                            <div className="metric-value">23%</div>
                            <div className="metric-label">Cost Reduction</div>
                          </div>
                          <div className="metric">
                            <div className="metric-value">$2,847</div>
                            <div className="metric-label">Monthly Savings</div>
                          </div>
                        </div>
                      </div>
                      <div className="dashboard-chart">
                        <div className="chart-bars">
                          <div className="chart-bar" style={{height: '60%'}}></div>
                          <div className="chart-bar" style={{height: '80%'}}></div>
                          <div className="chart-bar" style={{height: '45%'}}></div>
                          <div className="chart-bar" style={{height: '90%'}}></div>
                          <div className="chart-bar" style={{height: '70%'}}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="platform-features">
                  <div className="feature-card">
                    <div className="feature-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <h4>AI-Powered Menu Optimization</h4>
                    <p>Get daily recommendations on which dishes to promote based on inventory levels, expiration dates, and profit margins.</p>
                  </div>
                  <div className="feature-card">
                    <div className="feature-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2v20m8-10H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <h4>Cost Analysis & Tracking</h4>
                    <p>Monitor food costs across your entire operation with real-time data and comprehensive reporting.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="features">
          <div className="container">
            <div className="features-content">
              <div className="section-header">
                <div className="section-tag">FEATURES</div>
                <h2>Track costs, gain insights, maximize profits</h2>
                <div className="feature-highlights">
                  <div className="highlight">Real-time cost analysis</div>
                  <div className="highlight-divider"></div>
                  <div className="highlight">AI-driven recommendations</div>
                  <div className="highlight-divider"></div>
                  <div className="highlight">Waste reduction tracking</div>
                  <div className="highlight-divider"></div>
                  <div className="highlight">Margin optimization</div>
                </div>
              </div>
              <div className="features-showcase">
                <div className="feature-showcase-image">
                  <div className="feature-dashboard">
                    <div className="feature-dashboard-header">
                      <h4>Popular menu optimizations for your restaurant</h4>
                    </div>
                    <div className="feature-list">
                      <div className="feature-item">
                        <div className="feature-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 11H5a2 2 0 0 0-2 2v5c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2zM19 7h-4a2 2 0 0 0-2 2v9c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" fill="currentColor"/>
                          </svg>
                        </div>
                        <div className="feature-text">What dishes have the highest profit margins?</div>
                      </div>
                      <div className="feature-item">
                        <div className="feature-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="m19 9-5 5-4-4-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <div className="feature-text">Which ingredients are driving up costs?</div>
                      </div>
                      <div className="feature-item">
                        <div className="feature-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <div className="feature-text">What menu items should we promote today?</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Individual Feature Sections */}
        <section className="feature-sections">
          <div className="container">
            <div className="feature-section">
              <div className="feature-grid">
                <div className="feature-image">
                  <div className="feature-chart">
                    <div className="chart-title">Cost Analysis by Dish</div>
                    <div className="chart-content">
                      <div className="chart-item">
                        <span>Grilled Salmon</span>
                        <span className="chart-value">$8.50</span>
                        <div className="chart-indicator high"></div>
                      </div>
                      <div className="chart-item">
                        <span>Pasta Primavera</span>
                        <span className="chart-value">$4.25</span>
                        <div className="chart-indicator medium"></div>
                      </div>
                      <div className="chart-item">
                        <span>Ribeye Steak</span>
                        <span className="chart-value">$15.75</span>
                        <div className="chart-indicator low"></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="feature-content">
                  <div className="section-tag">COST ANALYSIS</div>
                  <h3>Real-Time Cost Analysis</h3>
                  <p className="feature-description">Track actual food costs per dish using invoice data and supplier pricing. Know your true margins on every menu item with daily updates.</p>
                  <div className="feature-benefits">
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Track actual food costs per dish using invoice data</span>
                    </div>
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Know your true margins on every menu item</span>
                    </div>
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Updated daily with real supplier pricing</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="feature-section">
              <div className="feature-grid reverse">
                <div className="feature-image">
                  <div className="feature-chart">
                    <div className="chart-title">AI Recommendations</div>
                    <div className="recommendation-list">
                      <div className="recommendation high-priority">
                        <div className="rec-status"></div>
                        <div className="rec-content">
                          <div className="rec-title">Promote Caesar Salad</div>
                          <div className="rec-subtitle">High margin, trending up 15%</div>
                        </div>
                      </div>
                      <div className="recommendation medium-priority">
                        <div className="rec-status"></div>
                        <div className="rec-content">
                          <div className="rec-title">Fish Tacos Alert</div>
                          <div className="rec-subtitle">Ingredients expiring in 2 days</div>
                        </div>
                      </div>
                      <div className="recommendation low-priority">
                        <div className="rec-status"></div>
                        <div className="rec-content">
                          <div className="rec-title">Optimize Burger Portions</div>
                          <div className="rec-subtitle">Cost savings opportunity available</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="feature-content">
                  <div className="section-tag">AI OPTIMIZATION</div>
                  <h3>AI-Driven Menu Optimization</h3>
                  <p className="feature-description">Receive intelligent daily recommendations based on inventory levels, expiration dates, and profit margins to maximize revenue.</p>
                  <div className="feature-benefits">
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Daily recommendations based on inventory levels</span>
                    </div>
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Minimize waste with expiration tracking</span>
                    </div>
                    <div className="benefit">
                      <div className="benefit-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span>Maximize profits with smart promotions</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="stats">
          <div className="container">
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    <polyline points="12,6 12,12 16,14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="stat-value">Real-Time</div>
                <div className="stat-label">Cost Tracking</div>
              </div>
              <div className="stat-item">
                <div className="stat-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="stat-value">Daily</div>
                <div className="stat-label">AI Recommendations</div>
              </div>
              <div className="stat-item">
                <div className="stat-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="m19 9-5 5-4-4-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="stat-value">30%</div>
                <div className="stat-label">Average Waste Reduction</div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="cta">
          <div className="container">
            <div className="cta-content">
              <div className="cta-badge">
                <div className="user-avatars">
                  <div className="avatar"></div>
                  <div className="avatar"></div>
                  <div className="avatar"></div>
                </div>
                <p>TRUSTED BY RESTAURANTS NATIONWIDE</p>
              </div>
              <h2>Turn your restaurant data into profit</h2>
              <p className="cta-description">Join hundreds of restaurants already optimizing their operations with optiMenu</p>
              <div className="cta-actions">
                <Link href="/client" className="btn btn-hero btn-primary">
                  Start Free Trial
                </Link>
                <Link href="#contact" className="btn btn-hero btn-outline">
                  Schedule Demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer id="contact" className="footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <Link href="/" className="footer-logo">
                <img src="/optimenu-logo.png" alt="optiMenu Solutions" className="footer-logo-img" />
              </Link>
              <p className="footer-description">AI-powered restaurant intelligence platform helping optimize costs and maximize profits.</p>
            </div>
            <div className="footer-section">
              <h4>Resources</h4>
              <ul className="footer-links">
                <li><Link href="#">Cost Analysis Guide</Link></li>
                <li><Link href="#">Menu Optimization</Link></li>
                <li><Link href="#">Restaurant Analytics</Link></li>
                <li><Link href="#">Best Practices</Link></li>
              </ul>
            </div>
            <div className="footer-section">
              <h4>Company</h4>
              <ul className="footer-links">
                <li><Link href="#">About Us</Link></li>
                <li><Link href="#">Our Story</Link></li>
                <li><Link href="#">Careers</Link></li>
                <li><Link href="#">Contact</Link></li>
              </ul>
            </div>
            <div className="footer-section">
              <h4>Contact</h4>
              <div className="footer-contact">
                <div className="contact-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>help@optimenu.com</span>
                </div>
                <div className="contact-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>(555) 123-4567</span>
                </div>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; 2025 optiMenu Solutions. All rights reserved.</p>
            <div className="footer-legal">
              <Link href="#">Privacy Policy</Link>
              <span>•</span>
              <Link href="#">Terms & Conditions</Link>
            </div>
          </div>
        </div>
      </footer>

      <style jsx>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: #1a1a1a;
          background: #ffffff;
          font-feature-settings: 'kern' 1;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* Header */
        .header {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          position: fixed;
          top: 0;
          width: 100%;
          z-index: 1000;
        }

        .nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          height: 80px;
        }

        .logo {
          display: flex;
          align-items: center;
        }

        .logo-img {
          height: 36px;
          width: auto;
        }

        .nav-links {
          display: flex;
          list-style: none;
          gap: 32px;
        }

        .nav-links a {
          text-decoration: none;
          color: #4a5568;
          font-weight: 500;
          font-size: 15px;
          transition: color 0.2s ease;
          position: relative;
        }

        .nav-links a:hover {
          color: #1a1a1a;
        }

        .nav-links a::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 0;
          width: 0;
          height: 2px;
          background: #2563eb;
          transition: width 0.2s ease;
        }

        .nav-links a:hover::after {
          width: 100%;
        }

        .nav-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .btn {
          padding: 12px 24px;
          border: 2px solid;
          border-radius: 8px;
          font-weight: 500;
          font-size: 14px;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .btn-primary {
          background: #2563eb;
          color: #ffffff;
          box-shadow: 0 1px 3px rgba(37, 99, 235, 0.3);
          border-color: #2563eb;
        }

        .btn-primary:hover {
          background: #1d4ed8;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        }

        .btn-secondary {
          background: transparent;
          color: #4a5568;
          border: 2px solid #e2e8f0;
        }

        .btn-secondary:hover {
          background: #f7fafc;
          border-color: #cbd5e0;
        }

        .btn-outline {
          background: transparent;
          color: #2563eb;
          border-color: #2563eb;
        }

        .btn-outline:hover {
          background: #2563eb;
          color: #ffffff;
        }

        .btn-hero {
          padding: 16px 32px;
          font-size: 16px;
          font-weight: 600;
          border-radius: 8px;
          border: 2px solid;
        }

        /* Main */
        .main {
          padding-top: 80px;
        }

        /* Hero */
        .hero {
          background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
          padding: 120px 0;
          position: relative;
          overflow: hidden;
        }

        .hero::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 70% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 50%);
        }

        .hero-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          position: relative;
          z-index: 2;
        }

        .hero-content {
          text-align: center;
          max-width: 800px;
          margin: 0 auto;
        }

        .hero-title {
          font-size: 4rem;
          font-weight: 700;
          line-height: 1.1;
          margin-bottom: 24px;
          color: #1a1a1a;
          letter-spacing: -0.02em;
        }

        .title-line {
          display: block;
        }

        .title-highlight.green {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-description {
          font-size: 1.25rem;
          color: #4a5568;
          max-width: 600px;
          margin: 0 auto 40px;
          font-weight: 400;
          line-height: 1.6;
        }

        .hero-actions {
          display: flex;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        /* Trusted By */
        .trusted-by {
          padding: 60px 0;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
        }

        .trusted-by-content {
          text-align: center;
        }

        .trusted-by-text {
          font-size: 12px;
          font-weight: 600;
          color: #718096;
          letter-spacing: 1px;
          margin-bottom: 32px;
        }

        .trusted-by-logos {
          display: flex;
          justify-content: center;
          gap: 40px;
          flex-wrap: wrap;
        }

        .logo-placeholder {
          padding: 16px 24px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          color: #4a5568;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        /* Section Tags */
        .section-tag {
          background: #dbeafe;
          color: #2563eb;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 16px;
          display: inline-block;
        }

        /* Platform */
        .platform {
          padding: 120px 0;
          background: #ffffff;
        }

        .section-header {
          text-align: center;
          margin-bottom: 80px;
          max-width: 800px;
          margin-left: auto;
          margin-right: auto;
        }

        .section-header h2 {
          font-size: 2.5rem;
          font-weight: 700;
          color: #1a1a1a;
          margin-bottom: 16px;
          letter-spacing: -0.02em;
        }

        .section-description {
          font-size: 1.125rem;
          color: #4a5568;
          font-weight: 400;
          line-height: 1.6;
        }

        .platform-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 60px;
          align-items: start;
        }

        .platform-card {
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
          border-radius: 16px;
          padding: 40px;
          color: white;
          position: relative;
          overflow: hidden;
          box-shadow: 0 10px 40px rgba(37, 99, 235, 0.2);
        }

        .platform-card::before {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          width: 100px;
          height: 100px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          transform: translate(30px, -30px);
        }

        .platform-card-content {
          position: relative;
          z-index: 2;
        }

        .platform-card h3 {
          font-size: 1.5rem;
          font-weight: 600;
          line-height: 1.3;
          margin-bottom: 16px;
          letter-spacing: -0.01em;
        }

        .platform-card p {
          color: rgba(255, 255, 255, 0.9);
          line-height: 1.6;
          margin-bottom: 32px;
        }

        .platform-image {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 24px;
          backdrop-filter: blur(10px);
        }

        .dashboard-preview {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 8px;
          padding: 20px;
          color: #1a1a1a;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .dashboard-title {
          font-weight: 600;
          font-size: 16px;
          color: #1a1a1a;
        }

        .dashboard-metrics {
          display: flex;
          gap: 24px;
        }

        .metric {
          text-align: center;
        }

        .metric-value {
          font-size: 18px;
          font-weight: 700;
          color: #2563eb;
        }

        .metric-label {
          font-size: 12px;
          color: #4a5568;
        }

        .dashboard-chart {
          height: 100px;
          background: #f8fafc;
          border-radius: 6px;
          padding: 16px;
          display: flex;
          align-items: end;
        }

        .chart-bars {
          display: flex;
          gap: 8px;
          width: 100%;
          height: 100%;
          align-items: end;
        }

        .chart-bar {
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
          border-radius: 2px;
          flex: 1;
          transition: all 0.3s ease;
        }

        .chart-bar:hover {
          opacity: 0.8;
        }

        .platform-features {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .feature-card {
          background: #ffffff;
          padding: 24px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
          transform: translateY(-2px);
        }

        .feature-icon {
          width: 48px;
          height: 48px;
          background: #dbeafe;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          color: #2563eb;
        }

        .feature-card h4 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 8px;
          color: #1a1a1a;
        }

        .feature-card p {
          color: #4a5568;
          line-height: 1.6;
          font-size: 14px;
        }

        /* Features */
        .features {
          padding: 120px 0;
          background: #f8fafc;
        }

        .feature-highlights {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 32px;
        }

        .highlight {
          font-weight: 500;
          color: #1a1a1a;
          font-size: 14px;
        }

        .highlight-divider {
          width: 4px;
          height: 4px;
          background: #cbd5e0;
          border-radius: 50%;
        }

        .features-showcase {
          margin-top: 60px;
        }

        .feature-showcase-image {
          max-width: 800px;
          margin: 0 auto;
        }

        .feature-dashboard {
          background: white;
          border-radius: 16px;
          padding: 32px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }

        .feature-dashboard-header h4 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 24px;
          color: #1a1a1a;
        }

        .feature-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .feature-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #f8fafc;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          transition: all 0.2s ease;
        }

        .feature-item:hover {
          background: #f1f5f9;
          border-color: #cbd5e0;
        }

        .feature-item .feature-icon {
          width: 32px;
          height: 32px;
          background: #dbeafe;
          border-radius: 8px;
          margin-bottom: 0;
          color: #2563eb;
        }

        .feature-text {
          font-weight: 500;
          color: #1a1a1a;
          font-size: 14px;
        }

        /* Feature Sections */
        .feature-sections {
          padding: 120px 0;
          background: white;
        }

        .feature-section {
          margin-bottom: 120px;
        }

        .feature-section:last-child {
          margin-bottom: 0;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 80px;
          align-items: center;
        }

        .feature-grid.reverse {
          direction: rtl;
        }

        .feature-grid.reverse > * {
          direction: ltr;
        }

        .feature-image {
          background: #f8fafc;
          border-radius: 16px;
          padding: 32px;
          border: 1px solid #e2e8f0;
        }

        .feature-chart {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
          border: 1px solid #e2e8f0;
        }

        .chart-title {
          font-weight: 600;
          margin-bottom: 20px;
          color: #1a1a1a;
          font-size: 16px;
        }

        .chart-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .chart-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid #f1f5f9;
          position: relative;
        }

        .chart-item:last-child {
          border-bottom: none;
        }

        .chart-value {
          font-weight: 600;
          color: #2563eb;
        }

        .chart-indicator {
          position: absolute;
          right: -8px;
          top: 50%;
          transform: translateY(-50%);
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .chart-indicator.high {
          background: #10b981;
        }

        .chart-indicator.medium {
          background: #f59e0b;
        }

        .chart-indicator.low {
          background: #ef4444;
        }

        .recommendation-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .recommendation {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: #f8fafc;
          border-radius: 8px;
          border-left: 3px solid transparent;
          transition: all 0.2s ease;
        }

        .recommendation.high-priority {
          border-left-color: #10b981;
          background: #ecfdf5;
        }

        .recommendation.medium-priority {
          border-left-color: #f59e0b;
          background: #fffbeb;
        }

        .recommendation.low-priority {
          border-left-color: #6b7280;
          background: #f9fafb;
        }

        .rec-status {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-top: 6px;
          flex-shrink: 0;
        }

        .high-priority .rec-status {
          background: #10b981;
        }

        .medium-priority .rec-status {
          background: #f59e0b;
        }

        .low-priority .rec-status {
          background: #6b7280;
        }

        .rec-content {
          flex: 1;
        }

        .rec-title {
          font-weight: 600;
          color: #1a1a1a;
          font-size: 14px;
          margin-bottom: 2px;
        }

        .rec-subtitle {
          font-size: 12px;
          color: #4a5568;
        }

        .feature-content h3 {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 16px;
          color: #1a1a1a;
          letter-spacing: -0.02em;
        }

        .feature-description {
          font-size: 1.125rem;
          color: #4a5568;
          line-height: 1.6;
          margin-bottom: 32px;
        }

        .feature-benefits {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .benefit {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 500;
          color: #1a1a1a;
          font-size: 14px;
        }

        .benefit-icon {
          color: #10b981;
          flex-shrink: 0;
        }

        /* Stats */
        .stats {
          padding: 80px 0;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 60px;
          text-align: center;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-icon {
          color: #2563eb;
          margin-bottom: 16px;
        }

        .stat-value {
          font-size: 2.5rem;
          font-weight: 700;
          color: #1a1a1a;
          margin-bottom: 8px;
          letter-spacing: -0.02em;
        }

        .stat-label {
          font-size: 14px;
          color: #4a5568;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* CTA */
        .cta {
          padding: 120px 0;
          background: white;
          text-align: center;
        }

        .cta-content {
          max-width: 600px;
          margin: 0 auto;
        }

        .cta-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 32px;
        }

        .user-avatars {
          display: flex;
          gap: -8px;
        }

        .avatar {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
          border-radius: 50%;
          border: 2px solid white;
          margin-left: -8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .avatar:first-child {
          margin-left: 0;
        }

        .cta-badge p {
          font-size: 12px;
          font-weight: 600;
          color: #718096;
          letter-spacing: 1px;
        }

        .cta-content h2 {
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 16px;
          color: #1a1a1a;
          letter-spacing: -0.02em;
        }

        .cta-description {
          font-size: 1.125rem;
          color: #4a5568;
          margin-bottom: 40px;
        }

        .cta-actions {
          display: flex;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        /* Footer */
        .footer {
          background: #1a202c;
          padding: 80px 0 40px;
          color: #cbd5e0;
        }

        .footer-content {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 60px;
          margin-bottom: 60px;
        }

        .footer-brand {
          display: flex;
          flex-direction: column;
        }

        .footer-logo {
          display: inline-block;
          margin-bottom: 24px;
        }

        .footer-logo-img {
          height: 32px;
          width: auto;
          filter: brightness(0) invert(1);
        }

        .footer-description {
          color: #a0aec0;
          line-height: 1.6;
          font-size: 14px;
        }

        .footer-section h4 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 24px;
          color: #ffffff;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .footer-links {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .footer-links a {
          color: #a0aec0;
          text-decoration: none;
          font-size: 14px;
          font-weight: 400;
          transition: color 0.2s ease;
        }

        .footer-links a:hover {
          color: #ffffff;
        }

        .footer-contact {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .contact-item {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #a0aec0;
          font-size: 14px;
        }

        .contact-item svg {
          color: #2563eb;
        }

        .footer-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 40px;
          border-top: 1px solid #2d3748;
        }

        .footer-bottom p {
          color: #a0aec0;
          font-size: 14px;
          font-weight: 400;
        }

        .footer-legal {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .footer-legal a {
          color: #a0aec0;
          text-decoration: none;
          font-size: 14px;
          font-weight: 400;
          transition: color 0.2s ease;
        }

        .footer-legal a:hover {
          color: #ffffff;
        }

        /* Responsive Design */
        @media (max-width: 1024px) {
          .platform-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }

          .feature-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }

          .feature-grid.reverse {
            direction: ltr;
          }

          .hero-title {
            font-size: 3.5rem;
          }

          .section-header h2 {
            font-size: 2.25rem;
          }
        }

        @media (max-width: 768px) {
          .nav-links {
            display: none;
          }

          .nav-actions {
            gap: 8px;
          }

          .btn {
            padding: 10px 20px;
            font-size: 13px;
          }

          .hero {
            padding: 80px 0;
          }

          .hero-title {
            font-size: 3rem;
          }

          .hero-description {
            font-size: 1.125rem;
          }

          .hero-actions {
            flex-direction: column;
            align-items: center;
          }

          .btn-hero {
            width: 100%;
            max-width: 300px;
          }

          .trusted-by-logos {
            flex-direction: column;
            align-items: center;
            gap: 16px;
          }

          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 40px;
          }

          .footer-content {
            grid-template-columns: 1fr;
            gap: 40px;
          }

          .footer-bottom {
            flex-direction: column;
            gap: 16px;
            text-align: center;
          }

          .section-header h2 {
            font-size: 2rem;
          }

          .cta-content h2 {
            font-size: 2rem;
          }

          .feature-highlights {
            flex-direction: column;
            gap: 8px;
          }

          .highlight-divider {
            display: none;
          }

          .platform {
            padding: 80px 0;
          }

          .features {
            padding: 80px 0;
          }

          .feature-sections {
            padding: 80px 0;
          }

          .cta {
            padding: 80px 0;
          }
        }

        @media (max-width: 480px) {
          .hero-title {
            font-size: 2.5rem;
          }

          .stats-grid {
            grid-template-columns: 1fr;
          }

          .platform-card {
            padding: 24px;
          }

          .feature-dashboard {
            padding: 20px;
          }

          .stat-value {
            font-size: 2rem;
          }

          .container {
            padding: 0 16px;
          }

          .nav {
            padding: 0 16px;
          }
        }
          .hero-actions .btn-hero.btn-primary {
            border: 2px solid #2563eb !important;
          }

          .hero-actions .btn-hero.btn-outline {
            border: 2px solid #2563eb !important;
          }
      `}</style>

      <Analytics />
      <SpeedInsights />
    </>
  )
}
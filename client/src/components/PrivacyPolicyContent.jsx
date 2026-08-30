import React from 'react';

export const PRIVACY_POLICY_EFFECTIVE_DATE = 'July 30, 2026';

/**
 * Pure policy content, no page chrome - reused by PrivacyPolicy.jsx (the
 * routed /privacy page) and PrivacyPolicyModal.jsx (the sign-up popup),
 * so the two can never drift out of sync with each other.
 *
 * Text is reproduced from EXTENDED_PRIVACY_POLICY.docx as provided,
 * covering five policy areas in one document (privacy, IP/copyright,
 * course terms, account policy, AI use policy). One addition not in the
 * source document: an explicit note on Google sign-in's data direction
 * (marked below), added to match this site's actual implementation -
 * see the surrounding chat for why.
 *
 * Sections 6-10 (general site use, report submissions, donations,
 * account termination, liability/governing law) are DRAFT text added
 * separately from the original document, covering site-wide terms of
 * service that weren't part of the original certification-platform-
 * scoped policy. Marked in the rendered page itself as not yet
 * attorney-reviewed - see the .about-draft-notice banner right before
 * section 6 below. Do not remove that notice without an actual legal
 * review of sections 6-10's content.
 */
export default function PrivacyPolicyContent() {
  return (
    <>
      <h4 className="about-subsection-title">1. Privacy Policy</h4>
      <p>
        The International Truth and Trauma Institute ("ITTI," "we," "our," or "us") respects your privacy and is
        committed to protecting the personal information you share with us through ittiglobal.org, its
        certification platform, learning portal, and related services.
      </p>
      <p>This Privacy Policy explains how we collect, use, store, protect, and disclose your information.</p>

      <p><strong>Information We Collect</strong></p>
      <p>We may collect:</p>
      <p><em>Personal Information</em></p>
      <ul>
        <li>Name</li>
        <li>Email address</li>
        <li>Mailing address</li>
        <li>Organization</li>
        <li>Job title</li>
        <li>Country</li>
        <li>Telephone number</li>
        <li>Billing information</li>
        <li>Certification history</li>
        <li>Professional credentials</li>
      </ul>
      <p><em>Account Information</em></p>
      <p>When you create an account we collect:</p>
      <ul>
        <li>Username</li>
        <li>Password (encrypted)</li>
        <li>Login history</li>
        <li>Account preferences</li>
        <li>Course progress</li>
        <li>Certification status</li>
      </ul>
      <p><em>Payment Information</em></p>
      <p>Payments are processed through secure third-party payment providers. ITTI does not store your complete credit card information.</p>
      <p><em>Technical Information</em></p>
      <p>We automatically collect information such as:</p>
      <ul>
        <li>IP address</li>
        <li>Browser</li>
        <li>Device type</li>
        <li>Operating system</li>
        <li>Cookies</li>
        <li>Website usage</li>
        <li>Learning analytics</li>
      </ul>

      <p><strong>How We Use Information</strong></p>
      <p>Information may be used to:</p>
      <ul>
        <li>Process enrollments</li>
        <li>Deliver certifications</li>
        <li>Verify credentials</li>
        <li>Issue certificates</li>
        <li>Maintain professional directory listings</li>
        <li>Improve courses</li>
        <li>Respond to inquiries</li>
        <li>Prevent fraud</li>
        <li>Comply with legal obligations</li>
      </ul>

      <p><strong>Cookies</strong></p>
      <p>We use cookies to improve your experience. You may disable cookies through your browser settings.</p>

      <p><strong>Data Sharing</strong></p>
      <p>We do not sell personal information. Information may only be shared:</p>
      <ul>
        <li>with payment processors</li>
        <li>with website service providers</li>
        <li>when required by law</li>
        <li>to protect legal rights</li>
      </ul>
      <p>
        If you sign in with Google, information flows from Google to us (your email, name, and profile picture) so
        we can create and recognize your account - we do not send your account information back to Google in
        return.
      </p>

      <p><strong>Data Security</strong></p>
      <p>We use commercially reasonable safeguards to protect information. However, no internet transmission can be guaranteed to be 100% secure.</p>

      <p><strong>Your Rights</strong></p>
      <p>Depending on your jurisdiction, you may request:</p>
      <ul>
        <li>access to your information</li>
        <li>correction</li>
        <li>deletion</li>
        <li>account closure</li>
        <li>withdrawal of consent</li>
      </ul>
      <p>You can also view your information on your Profile page and update it from Settings at any time.</p>

      <p><strong>Contact</strong></p>
      <p>support@ittiglobal.org</p>

      <h4 className="about-subsection-title">2. Intellectual Property &amp; Copyright Policy</h4>
      <p>Everything published on ITTI is proprietary unless expressly stated otherwise. This includes, but is not limited to: all certification curricula, learning modules, presentations, instructor guides, videos, slides, graphics, assessments, examinations, workbooks, research reports, dashboards, country profiles, Observatory materials, methodologies, analytical frameworks, scoring systems, templates, checklists, toolkits, capstone materials, digital badges, logos, trademarks, names, branding, website design, databases, software, and downloadable resources, including all future revisions.</p>

      <p><strong>Proprietary Methodologies</strong></p>
      <p>The following are proprietary intellectual property of ITTI:</p>
      <ul>
        <li>Election Trauma and Tension Index (ETTI™)</li>
        <li>Global Trauma Burden Indicator (GTBI™)</li>
        <li>National Truth &amp; Trauma Commission (NTTC™)</li>
        <li>International Trauma Observatory</li>
        <li>Trauma Observatory Framework</li>
        <li>ITTI Professional Certification System</li>
        <li>ITTI Fellowship System</li>
      </ul>
      <p>and any related scoring systems, frameworks, algorithms, analytical models, visualizations, manuals, or derivative works.</p>

      <p><strong>Ownership</strong></p>
      <p>Purchasing a course does NOT transfer ownership. Participants receive only a limited, non-transferable license for personal professional learning. Ownership always remains with ITTI.</p>

      <p><strong>No Unauthorized Use</strong></p>
      <p>Without written permission you may NOT copy, photograph, screenshot, record, film, livestream, translate, republish, upload, share, distribute, resell, modify, or create derivative works from ITTI materials; teach using ITTI materials or train others with them; post them online or upload them to AI systems (including ChatGPT, Claude, Gemini, Copilot, DeepSeek, or similar systems) for redistribution or model training; sell summaries or repackage content; create competing certifications; reverse engineer methodologies; or duplicate examinations, toolkits, dashboards, country profiles, or Observatory materials.</p>

      <p><strong>Printed Materials</strong></p>
      <p>Printing materials does not transfer ownership. Printed materials remain protected by United States copyright law, international copyright treaties, trademark law, and intellectual property law. This protection continues permanently regardless of format.</p>

      <p><strong>Digital Materials</strong></p>
      <p>Downloaded files remain protected. Downloading does not transfer ownership.</p>

      <p><strong>Violations</strong></p>
      <p>Unauthorized use may result in termination of account, revocation of certifications, permanent removal, legal action, civil damages, injunctive relief, and recovery of attorney fees where permitted.</p>

      <h4 className="about-subsection-title">3. Certification Course Terms of Use</h4>
      <p>Enrollment grants participants a limited license to complete the certification. Participants may view lessons, download approved resources, complete assignments, and earn certification. Participants may not redistribute any course materials.</p>
      <p>Certification does not authorize participants to teach ITTI curriculum, certify others, license ITTI materials, represent ITTI, or modify proprietary methodologies.</p>

      <h4 className="about-subsection-title">4. Account Creation &amp; User Account Policy</h4>
      <p>To access portions of ITTI you may create an account. You agree to provide accurate information, maintain current information, protect your password, maintain confidentiality, and notify ITTI of unauthorized access.</p>
      <p>Each account is for one individual only. Accounts may not be shared, loaned, sold, transferred, or leased. Multiple simultaneous logins may result in suspension.</p>

      <p><strong>Account Suspension</strong></p>
      <p>ITTI may suspend or terminate accounts for copyright violations, credential fraud, cheating, harassment, unauthorized sharing, reverse engineering, misuse of trademarks, payment fraud, false identity, or attempts to circumvent security.</p>

      <p><strong>Certification Records</strong></p>
      <p>ITTI maintains certification records for credential verification. Credential status may be Active, Expired, Suspended, or Revoked. Revocation may occur for academic dishonesty, unethical conduct, misuse of an ITTI designation, or violation of ITTI policies.</p>

      <h4 className="about-subsection-title">5. AI &amp; Large Language Model Use Policy</h4>
      <p>Unless expressly authorized in writing by ITTI, no person or organization may use ITTI materials to train or fine-tune artificial intelligence models; create derivative AI-generated educational content; build competing certification programs; develop automated tutoring systems using ITTI content; scrape, mine, or systematically extract ITTI materials; or reproduce ITTI methodologies through AI-assisted tools.</p>
      <p>Participants may use publicly available AI tools for personal study assistance but may not upload substantial portions of ITTI's proprietary materials, examinations, manuals, toolkits, or assessment content into AI platforms if doing so would reproduce, distribute, or compromise ITTI's intellectual property.</p>

      <div className="about-draft-notice">
        Sections 6-10 below are draft terms covering site use beyond the certification platform (report
        submissions, donations, account termination, liability, and governing law). They have not yet been
        reviewed by an attorney and should be treated as a starting point, not final legal text.
      </div>

      <h4 className="about-subsection-title">6. General Site Use</h4>
      <p>
        Beyond the certification platform covered above, ittiglobal.org includes a public Trauma Observatory,
        published research reports, country profiles, and a donation system. By using any part of the site you
        agree not to: interfere with or disrupt the site or its underlying infrastructure; attempt to gain
        unauthorized access to any account, system, or data; upload malicious code; impersonate any person or
        organization; or use the site for any unlawful purpose. ITTI may remove content or restrict access for
        violations of this policy.
      </p>

      <h4 className="about-subsection-title">7. Report Submissions &amp; User-Submitted Content</h4>
      <p>
        Publishers may submit reports, research, and related files for peer review and, if approved, publication
        on the public Reports page. By submitting a report, you represent that you own or have the necessary
        rights to the content you're submitting, and you grant ITTI a non-exclusive, worldwide license to host,
        display, and distribute that content on ittiglobal.org for as long as it remains published. You retain
        ownership of your own work; ITTI does not claim ownership of a report by publishing it.
      </p>
      <p>
        A published report may be removed at the uploader's request (subject to reviewer approval, per the
        deletion-request process described in the site's own documentation) or by ITTI directly for policy
        violations. ITTI is not responsible for the accuracy, completeness, or conclusions of any user-submitted
        report; published reports reflect their authors' views, not necessarily ITTI's own.
      </p>

      <h4 className="about-subsection-title">8. Donations &amp; Payments</h4>
      <p>
        Donations made through ittiglobal.org are processed by a third-party payment processor; ITTI does not
        store your full payment card details (see the Payment Information section above). Donations are
        generally non-refundable except where required by law or at ITTI's sole discretion. Contact
        support@ittiglobal.org for questions about a specific donation or a refund request.
      </p>

      <h4 className="about-subsection-title">9. Account Termination</h4>
      <p>
        In addition to ITTI-initiated suspension described above, you may close your own account at any time
        from your account settings. Closing your account deactivates it but does not automatically remove
        content you've published (e.g. a live report) - see Section 7 above for how published content is
        removed. Some information may be retained after account closure where required for legal, accounting,
        or security purposes.
      </p>

      <h4 className="about-subsection-title">10. Disclaimers, Liability &amp; Governing Law</h4>
      <p>
        The site and its content are provided "as is" without warranties of any kind, express or implied,
        including but not limited to warranties of accuracy, merchantability, or fitness for a particular
        purpose. To the fullest extent permitted by law, ITTI is not liable for any indirect, incidental, or
        consequential damages arising from your use of the site.
      </p>
      <p>
        These terms are governed by the laws of [jurisdiction to be specified], without regard to conflict-of-law
        principles. ITTI may update these terms from time to time; continued use of the site after an update
        constitutes acceptance of the revised terms. Material changes will be reflected by an updated effective
        date at the top of this page.
      </p>
    </>
  );
}
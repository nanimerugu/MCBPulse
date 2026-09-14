SCHOOL OPERATING SYSTEM
MyClassBoard Functional Re-Engineering Blueprint
Full product map • architecture • database • RBAC • workflows • APIs • mobile • AI • QA • Claude build plan
Prepared as a functional implementation blueprint based on publicly visible product information.
Target: build a modern, modular, multi-tenant school ERP/LMS/CRM platform in Claude.

# 1. Executive Summary
The target is not a single school ERP screen set. It is a School Operating System composed of ERP, LMS, Admissions CRM, Finance, HR, communication, safety/security, mobile apps, curriculum engines, and an AI layer. MyClassBoard's public product catalog currently exposes ERP, Finance, Admissions, HR, LMS, Connect and Ved AI, plus solution groups for Safety & Security, Mobile Apps and curriculum-specific products.
This document converts those publicly visible capabilities into an implementation-ready product architecture. It deliberately focuses on functional parity and a cleaner modern architecture rather than copying proprietary source code, branding, UI assets, or confidential implementation details.
Domain
Publicly visible scope
Implementation target
ERP
17 listed modules
Student/academic/operations core
Finance
8 listed modules
Fees, payments, expenses, store, canteen, banking
Admissions
5 listed modules + CRM capabilities
Lead-to-enrollment pipeline
HR
5 listed modules
Employee lifecycle, assessment, payroll
LMS
20 listed modules
Curriculum, content, assignments, exams, grading
Connect
9 listed communication modules
Omnichannel school communication
Ved AI
AI assistant + assessment/teaching capabilities
School-specific AI copilot
Safety & Security
VTS, RFID, visitor, SQAA, infirmary
Campus safety layer
Mobile
Parent, Admin/Smart, Pre-admission
Role-specific mobile apps
Curriculum
Preschool, IB, State/CBSE, Cambridge, Montessori, Higher Ed
Pluggable curriculum engines
# 2. Source Product Map — What Was Found
The source page groups products into ERP, Finance, Admission, HR, LMS and Connect. The broader site also exposes Ved AI and separate solution groups for safety/security, mobile apps and curriculum-specific deployments.
ERP modules:
SIS — student information and data management
Certificates — automated certificate issuance/management
Student Profile — rich student profile
Digital Document Library — centralized documents
School Services — service access/workflows
Inventory — school resource management
Library — physical/digital library operations
SQAA — quality/academic excellence and feedback
School Achievements — achievements and milestones
Dynamic Forms — configurable data collection
Hostel — hostel administration
Alumni Management — alumni relationships
Automated Alerts — event/condition notifications
Transport — transport operations
Concerns — student/staff concern management
Franchise — multi-branch oversight
Student Council — student council operations
Finance modules:
Finance / fee management
School Store
Connected Banking
PDC Management
Expenses
Student Loans
Canteen
School Services
Admissions:
Lead Management
Lead Nurturing
Campaign Management
Admission Plus CRM
WhatsApp Business Marketing
HR:
HR
Staff Assessment
Staff Wall
Praises & Feedback
HR Plus / payroll
LMS:
Assessments
Collaborative Learning
Bloom's Taxonomy
Preschool
Course Management
Teaching Plan
Online Exams
Games & PET
Montessori
GSuite integration
Online Classes
State & CBSE Grade Book
IB Grade Book
Higher Education
Holistic Report Card
Content Management
Objective Exams
Cambridge Grade Book
Assignment
Examcell
Connect:
SMS
Diary
Notifications
WhatsApp
Announcements
Student Wall
Email
School Calendar
Click-to-Call / Voice Calls / Photo Gallery
Additional solution groups:
Safety & Security: VTS, RFID, Visitor Management, SQAA, Infirmary
Mobile Apps: Parent App, Smart School/Admin App, Pre-Admission App
Curriculum: Preschool, IB, State/CBSE, Cambridge, Montessori, Higher Ed
Ved AI: grammar correction, lesson plans, email writing, YouTube summarization, LMS assistance, rewriting, translation, document extraction, AI grading, worksheets and question papers
Public-source evidence: MyClassBoard's product catalog lists the above modules and categories. citeturn0view0turn1search7
Admission Plus public documentation additionally describes mobile/email validation, document upload, two-way chat, application management, payment gateway, chatbot, landing pages, campaign messaging, WhatsApp, appointments and application tracking. citeturn1search1turn1search9
Ved AI public material describes lesson plans, writing assistance, multilingual translation, YouTube summarization, content extraction and AI assessment/question-paper workflows. citeturn1search3turn1search5turn1search12
# 3. Product Strategy for the Re-Engineered Platform
Recommended positioning: one unified School Operating System with a shared data layer, shared identity, shared workflow engine and shared notification/AI infrastructure.
Layer
Purpose
Rule
Foundation
Tenant, branch, academic year, users, roles, permissions
Everything is tenant-aware
Core SIS
Student/staff/guardian/master data
Single source of truth
Academic
Curriculum, timetable, attendance, grading, exams
Curriculum adapters
Finance
Fees, payments, expenses, payroll, store
Double-entry-ready ledger model
Admissions
Leads, campaigns, applications, enrollment
CRM + workflow
LMS
Content, courses, assignments, online exams
Reusable content objects
Communication
SMS, email, WhatsApp, push, voice
Provider abstraction
Operations
Transport, hostel, library, inventory, canteen, visitor
Event-driven
HR
Recruitment, employee, attendance, leave, payroll, appraisal
Employee lifecycle
AI
Copilot, generation, extraction, grading, insights
Permission-aware AI gateway
Analytics
Dashboards, reports, exports, audit
Event + warehouse friendly
# 4. Identity, Tenancy and Role Model
Use hierarchical multi-tenancy: Platform → Organization/Trust → School Group → Branch/Campus → Academic Year → Class/Section.
Role
Primary responsibilities
Typical access
Platform Admin
SaaS operations
All tenants, billing, feature flags
Organization Admin
Trust/group administration
All branches
Principal
School leadership
Cross-module school-wide
Vice Principal
Academic/operations oversight
Academic + operations
Admin/Front Office
Daily administration
SIS, admissions, documents, visitors
Teacher
Teaching and assessment
Assigned classes/subjects
Class Teacher
Class ownership
Class students + parent communication
Accountant
Fees and finance
Finance only
HR Manager
Employee lifecycle
HR/payroll
Librarian
Library
Library
Transport Manager
Routes/vehicles
Transport
Hostel Warden
Hostel
Hostel
Counselor/Admission Agent
Lead conversion
Admissions CRM
Parent
Child information/actions
Own child/children
Student
Learning and profile
Own records
Driver
Transport execution
Assigned vehicle/route
Visitor/Security
Campus entry
Visitor module
Alumni
Alumni portal
Own profile/community
# 5. Core Permission Architecture
RBAC: role → permission bundles → module/action.
ABAC: additionally restrict by organization, branch, campus, academic year, class, section, subject and ownership.
Every API checks tenant_id + user scope before authorization.
Support explicit actions: view, create, edit, delete, approve, publish, export, message, pay, refund, configure.
Approval rules are configurable and can be single-level or multi-level.
Maintain immutable audit logs for financial, academic, identity and administrative actions.
authorize(user, action, resource) -> tenant_scope -> role_permission -> attribute_policy -> approval_policy -> allow/deny
# 6. Recommended Technical Architecture
Start as a modular monolith for speed in Claude; design module boundaries so services can later be extracted. Do not start with dozens of microservices.
Component
Recommended implementation
Why
Frontend
Next.js + TypeScript + Tailwind + component system
Fast SaaS UI and responsive portals
Mobile
React Native / Expo
One codebase for parent, teacher/admin and student
Backend
NestJS or FastAPI modular monolith
Typed APIs and strong module boundaries
DB
PostgreSQL
Relational school/finance data
Cache
Redis
Sessions, queues, rate limits, caching
Search
OpenSearch/Elasticsearch or Postgres FTS initially
People, documents, library, admissions
Object storage
S3-compatible storage
Documents, photos, certificates, recordings
Queue
BullMQ / Redis initially; Kafka later
Notifications, imports, reports, AI jobs
Realtime
WebSocket/SSE
Chat, notifications, live transport, status
Auth
OIDC/OAuth2 + JWT + refresh tokens
SSO and secure sessions
Observability
OpenTelemetry + structured logs + Sentry
Production diagnostics
Analytics
Postgres read models → warehouse later
Start simple, scale later
AI
Provider abstraction for LLMs + embeddings
Avoid vendor lock-in
# 7. High-Level System Architecture
Web / Mobile / Public Admission Pages        |     API Gateway / BFF        |+-------+------------------------------------------------------+| Identity & Tenant Context                                  |+-------+------------------------------------------------------+        |+-------+------------------------------------------------------+| Modular Application Layer                                 || SIS | Academics | LMS | Admissions | Finance | HR        || Connect | Transport | Hostel | Library | Inventory | AI   |+-------+------------------------------------------------------+        |+-------+------------------------------------------------------+| Shared Services                                             || Workflow | Notifications | Files | Search | Payments     || Audit | Reporting | Scheduler | Integrations | Feature Flags |+-------+------------------------------------------------------+        |+-------+------------------------------------------------------+| PostgreSQL | Redis | Object Storage | Queue | Search       |+------------------------------------------------------------+        |External: WhatsApp/Meta | SMS | Email | Voice | Payment | MapsGoogle Workspace | Zoom/Meet | RFID/GPS | Banking | AI Providers
# 8. Canonical Data Model
Use normalized transactional tables plus denormalized reporting views. Never duplicate student identity across modules.
Domain
Core entities
Tenant
organizations, schools, branches, campuses, academic_years
Identity
users, roles, permissions, role_assignments, sessions, devices
People
students, guardians, staff, emergency_contacts, addresses
Academics
grades, sections, subjects, curriculum, subject_assignments, timetables
Attendance
attendance_sessions, attendance_records, leave_requests
Admissions
leads, lead_sources, campaigns, enquiries, applications, documents, appointments
LMS
courses, modules, lessons, resources, enrollments, assignments, submissions
Assessment
question_banks, questions, exams, papers, attempts, grades, rubrics
Finance
fee_heads, fee_structures, invoices, invoice_lines, receipts, payments, concessions, refunds
Accounting
accounts, journal_entries, journal_lines, reconciliation_records
HR
employees, departments, positions, attendance, leave, payroll_runs, payslips, appraisals
Operations
vehicles, routes, stops, hostel_rooms, inventory_items, library_items, canteen_items
Communication
templates, campaigns, messages, conversations, notifications, delivery_logs
Files
files, folders, file_links, document_versions
AI
ai_threads, ai_messages, prompts, generations, citations, usage_records
Audit
audit_events, approval_requests, workflow_instances
# 9. Important Database Rules
Every business table carries organization_id and usually branch_id + academic_year_id when applicable.
Use UUIDs for public identifiers; keep internal numeric IDs only if needed for performance.
Soft-delete configuration and master data; use immutable ledger/audit records for finance.
Student records should support multiple guardians and multiple siblings.
Academic year changes must not overwrite historical grades, fees or attendance.
All uploaded files require owner, tenant, classification, checksum, MIME type, version and retention metadata.
Use optimistic locking/version columns for high-conflict records such as fee invoices and attendance.
Encrypt sensitive fields at rest where practical and always encrypt transport.
# 10. Master User Flows
## 10.1 School onboarding
Platform Admin creates organization → chooses plan → creates school/branch.
School Admin configures academic year, grades, sections, subjects, houses, fee heads and roles.
Import staff and students using validated CSV/Excel templates.
Map guardians, classes, transport routes and fee structures.
Configure notification providers, WhatsApp templates, payment gateway and branding.
Run readiness checklist → test notifications/payment → activate school.
## 10.2 Student lifecycle
Admission lead → enquiry → application → document checklist → assessment/interview → offer → fee payment → enrollment.
Enrollment creates student master record and links guardians.
Assign academic year, grade, section, roll number and optional house.
Generate ID card and required certificates.
Student receives app access based on guardian/student policy.
At year end: promote, retain, transfer or graduate.
Graduation creates alumni record while preserving academic history.
## 10.3 Teacher daily workflow
Login → dashboard shows timetable, pending attendance, assignments, messages and alerts.
Open class → take period attendance → submit.
Teach from lesson plan/content → assign resources.
Create assignment/test → publish → students submit.
Grade manually or with AI-assisted first-pass grading where enabled.
Publish remarks/report card inputs.
Respond to parent/student messages within permitted channels.
## 10.4 Parent workflow
Login/OTP → select child.
Dashboard: attendance, timetable, fees, homework, exams, notices, transport and messages.
View/pay fee → receipt stored in transaction history.
View assignment → download/upload submission.
View results/report card → acknowledge where configured.
Chat with school/counselor within allowed communication windows.
Receive push/SMS/email/WhatsApp notifications.
## 10.5 Admissions CRM
Lead enters via website form, chatbot, campaign landing page, WhatsApp, import or manual entry.
Normalize and deduplicate lead.
Assign source, branch, counselor and stage.
Automated follow-up schedule creates tasks/reminders.
Counselor logs calls/messages and next action.
Application form + OTP validation + document upload.
Appointment/interview → decision → fee/payment → enrollment.
Lost leads enter nurture sequence rather than disappearing.
## 10.6 Finance / fee collection
Configure fee heads → fee structure → concessions/scholarships → student assignment.
Generate invoice/demand → notify guardian.
Guardian pays online or cashier records offline payment.
Payment gateway webhook verifies transaction.
Receipt issued automatically.
Partial payment, overpayment, refund, cancellation and failed payment are handled explicitly.
Daily reconciliation compares gateway/bank/cash against internal ledger.
Month/year closing freezes historical records.
## 10.7 HR lifecycle
Recruitment → candidate → interview → offer → employee onboarding.
Create employee profile, documents, department, designation and compensation.
Attendance/leave feeds payroll.
Monthly payroll calculates earnings, deductions, reimbursements and statutory fields.
Generate payslip and payroll reports.
Appraisal uses configurable assessment levels/objectives/weightages.
Resignation → approval → exit checklist → final settlement → archive.
## 10.8 LMS + exams
Create curriculum/course → module → lesson → resources.
Assign course to grade/section/subject.
Teacher publishes lesson/resources.
Create question bank by subject, topic, difficulty, type and curriculum.
Create exam/paper using manual or AI generation.
Configure schedule, duration, attempts, randomization and marks.
Student attempts exam → autosave → submit.
Auto-grade objective items; teacher/AI-assisted grade subjective items.
Publish results → gradebook → report card → analytics.
## 10.9 Transport
Create vehicles, drivers, routes and stops.
Assign students to route/stop.
GPS device/mobile driver app emits location events.
Parent sees bus status and ETA where enabled.
Boarding/alighting events update safety status.
Exceptions generate alerts to transport admin and authorized guardians.
## 10.10 Visitor management
Visitor pre-registers or security creates walk-in entry.
Capture identity/document/photo and host.
Optional approval and watchlist check.
Generate visitor pass/QR.
Check-in → visit → check-out.
Emergency dashboard shows active visitors.
# 11. Module-by-Module Functional Specification
## 11.1 SIS
Student 360 profile; guardians; addresses; medical/emergency info; identifiers; documents; sibling links.
Bulk import/export with mapping, validation preview, duplicate detection and rollback.
Enrollment, promotion, transfer, withdrawal, alumni conversion.
Custom fields and configurable student forms.
Search by student, admission number, parent phone, class, section and status.
Timeline of major events and audit history.
## 11.2 Certificates & documents
Certificate templates with variables, numbering and approval workflow.
Generate PDF, bulk generate, verify via QR/public verification page.
Document library with folders, tags, permissions, expiry and versioning.
## 11.3 Attendance
Daily, period-wise and subject-wise attendance.
Bulk marking, correction workflow, late/absent reasons, leave integration.
Parent notifications and attendance analytics.
Attendance lock after configured time with approval for edits.
## 11.4 Timetable
Academic timetable, teacher timetable, room timetable and substitution.
Conflict detection for teacher, room, class and subject.
Recurring schedules and temporary overrides.
## 11.5 Library
Catalog, authors, categories, copies, barcodes/QR, issue/return, reservations, fines.
Digital resources and access controls.
Lost/damaged workflows and inventory reconciliation.
## 11.6 Inventory
Item master, suppliers, purchase requests, purchase orders, GRN, stock locations, issue/return, transfer, low-stock alerts.
Asset register with serial numbers, depreciation-ready fields and maintenance history.
## 11.7 Hostel
Hostel/block/room/bed hierarchy, allocations, occupancy, fees, leave/outpass, visitor logs, incidents and warden dashboard.
## 11.8 Alumni
Alumni profiles, batches, education/career, events, communication, donations, mentorship and placement opportunities.
## 11.9 Dynamic forms
Drag/drop fields, conditional logic, validation, sections, permissions, workflows, file uploads and reusable templates.
Use the same form engine for admissions, concerns, HR, surveys and internal requests.
## 11.10 Finance
Fee heads, fee structures, concessions, scholarships, invoices, receipts, online/offline payments, refunds, PDC, dues and aging.
Cashier, bank reconciliation, connected banking, expense approvals and financial reporting.
## 11.11 School store & canteen
Catalog, stock, price lists, POS, student wallet/prepaid balance, orders, refunds and settlement.
Canteen meal plans, consumption tracking and cashless transactions.
## 11.12 Admissions CRM
Lead capture, source attribution, deduplication, lead scoring, counselor assignment, pipeline stages, tasks, calls, chat, appointments, campaigns, landing pages and application portal.
WhatsApp/email/SMS sequences and follow-up automation.
Application document checklist, payment, approval/rejection, waitlist and enrollment conversion.
## 11.13 HR
Employee master, org chart, recruitment, onboarding, attendance, leave, documents, payroll, statutory configuration, appraisal, feedback, staff wall and exit.
## 11.14 LMS
Course builder, content library, lesson plans, collaborative learning, assignments, online classes, assessments and progress analytics.
Support curriculum-specific grading engines rather than hard-coding one grading model.
## 11.15 Examcell
Question bank, blueprint, paper generation, moderation, versions, hall tickets, seating, invigilation, marks entry, moderation, result publishing and revaluation.
AI generator supports syllabus restrictions, question types, marks, difficulty, randomization, preview/edit and export.
## 11.16 Connect
Announcements, diary, school calendar, student wall, email, SMS, WhatsApp, push and voice/click-to-call.
Template engine, audience segmentation, scheduling, approval, delivery tracking, retries and opt-out policy.
## 11.17 Safety
Visitor management, transport tracking, RFID/access events, infirmary, incidents and emergency broadcast.
Central safety dashboard with active incidents, visitors, buses and alerts.
## 11.18 AI
Writing assistant, translation, summarization, lesson plans, assessment generation, document extraction, grading assistance and school analytics copilot.
Every AI action is permission-aware, logged and traceable to source records.
# 12. Shared Workflow & Automation Engine
This is a major gap to avoid: do not build each module's approvals and notifications separately.
Capability
Design
Trigger
record.created, status.changed, payment.received, attendance.marked, document.expiring, date.reached, webhook.received
Conditions
field comparisons, role, branch, grade, amount, status, time window
Actions
assign, notify, approve, create task, update field, generate document, send message, call webhook
Approvals
serial/parallel approvers, SLA, escalation, delegation
Schedules
one-time, recurring, relative-to-event
Retries
exponential backoff + dead-letter queue
Audit
store workflow version, input, action, result and actor
Example:WHEN application.status = "DOCUMENTS_PENDING"IF missing_document_count > 0THEN create reminder taskAND send WhatsApp templateAND send emailAFTER 3 daysIF still pendingTHEN escalate to counselor manager
# 13. Omnichannel Communication Architecture
Create a Notification Service with provider adapters: Email, SMS, WhatsApp, Push, Voice.
Template variables come from an approved data context; never let arbitrary templates read unrestricted student data.
Every message has campaign_id/event_id, recipient, provider, status, provider_message_id, timestamps and failure reason.
Support consent, quiet hours, opt-out, channel fallback and rate limits.
Use queue workers so a school action does not block on external providers.
# 14. API Architecture
Use REST for most transactional APIs and WebSockets/SSE for realtime. GraphQL is optional for complex dashboards but not required.
API group
Example endpoints
Auth
POST /auth/login, POST /auth/refresh, POST /auth/logout
Tenants
GET /organizations, GET /schools, GET /branches
Students
GET/POST/PATCH /students, GET /students/:id/timeline
Admissions
GET/POST /leads, POST /applications, POST /applications/:id/approve
Finance
GET /invoices, POST /payments, POST /refunds, POST /reconciliation
LMS
GET /courses, POST /assignments, POST /submissions
Exams
GET /question-bank, POST /exams, POST /attempts/:id/submit
HR
GET /employees, POST /leave-requests, POST /payroll/runs
Connect
POST /messages, POST /campaigns, GET /delivery-logs
Transport
GET /routes, POST /gps/events
AI
POST /ai/chat, POST /ai/generate-assessment, POST /ai/extract
Files
POST /files/presign, POST /files/complete, GET /files/:id
Reports
POST /reports/run, GET /reports/:id/status
# 15. Event-Driven Integration Map
Event
Consumers
student.enrolled
Finance, Connect, Identity, Analytics
student.promoted
Academics, Finance, Connect
application.submitted
Admissions, Workflow, Notifications
payment.succeeded
Finance, Receipt, Connect, Analytics
payment.failed
Finance, Workflow, Connect
attendance.marked
Connect, Analytics, Alerts
assignment.published
Connect, Student App
exam.result.published
Connect, Gradebook, Analytics
employee.joined
HR, Identity, Payroll
payroll.completed
HR, Connect, Accounting
vehicle.location.updated
Transport, Parent App
visitor.checked_in
Security Dashboard, Alerts
ai.generation.completed
AI audit, module consumer
# 16. Mobile App Architecture
App
Core features
Parent App
Children, attendance, homework, fees, payments, results, notices, calendar, transport, chat, documents
Teacher/Staff App
Timetable, attendance, diary, assignments, grading, notices, leave, staff wall, communication
Admin/Management App
Dashboard, approvals, finance snapshots, admissions, attendance, incidents, transport, reports
Student App
Timetable, content, assignments, exams, results, calendar, messages
Pre-Admission App
Branch selection, enquiry, OTP validation, application, documents, payment, status, chat
Driver App
Trip start/stop, GPS, boarding, alerts, route and passenger list
Security App
Visitor check-in, QR scanning, emergency dashboard
# 17. Reporting & Analytics
Dashboard builder with reusable KPI cards, charts, tables, filters and drill-down.
Standard reports: enrollment, attendance, fees due/collected, admissions funnel, teacher workload, exam results, transport, hostel, library, HR and payroll.
Every report supports branch, academic year, date range and relevant dimensions.
Exports: CSV/XLSX/PDF; large reports run asynchronously.
Snapshot critical metrics daily to prevent expensive repeated aggregation.
Create a semantic metric layer so 'active students' or 'fee collected' has one definition across the platform.
# 18. Security, Privacy and Compliance
Tenant isolation at application and database policy level.
MFA for privileged roles; optional OTP/passkey for parents.
Short-lived access tokens + rotating refresh tokens.
Encrypt secrets using managed secret storage; never store provider credentials in database plaintext.
Audit all login, permission changes, exports, financial actions, grade changes and impersonation.
Use signed URLs for files and short expiration.
PII minimization, retention rules, deletion/anonymization workflow and data export.
Backups: daily full + point-in-time recovery; test restores.
Rate limiting and bot protection for public admission pages and chatbots.
Separate production, staging and development data.
For India, design for applicable education, privacy, payment and tax/statutory requirements; obtain legal review before production.
# 19. AI Architecture — Ved AI Equivalent + Better
Implement an AI Gateway rather than calling an LLM directly from each module.
UI / Module   -> AI Gateway      -> policy check      -> prompt template      -> retrieval (tenant-scoped)      -> model router      -> tool execution      -> output validation      -> citation/source linking      -> audit + usage
AI capability
Inputs
Output
Guardrail
Lesson planner
grade, subject, topic, duration, curriculum
lesson plan
curriculum scope
Question generator
syllabus/content, difficulty, marks
question paper
source grounding
Worksheet generator
topic/content
worksheet
teacher review
AI grading
rubric + student answer
suggested marks/feedback
teacher final approval
Writing assistant
draft + audience + tone
rewritten text
no unsupported claims
Translation
approved text + language
translated text
preserve names/format
Document extraction
PDF/image/sheet
structured fields
confidence + human review
School copilot
authorized records
answer/action proposal
permission + citations
Predictive insights
attendance/grades/operations
risk/insight
explainability + human action
# 20. Claude Build Strategy — Step-by-Step
The safest approach is to give Claude a product specification in controlled slices. Do not ask Claude to generate the entire ERP in one prompt.
Phase
Build scope
Phase 0 — Foundation
Repository, environment, design system, auth, tenant model, audit, feature flags, CI/CD.
Phase 1 — SIS
Organizations, branches, academic years, students, guardians, staff, classes, sections, imports.
Phase 2 — Academics
Subjects, curriculum, timetable, attendance, teacher workflows.
Phase 3 — Admissions
Leads, pipeline, application, forms, documents, campaigns, portal, chatbot.
Phase 4 — Finance
Fee structure, invoices, payments, receipts, concessions, expenses, reconciliation.
Phase 5 — LMS
Courses, content, assignments, assessments, question bank, exams, gradebook.
Phase 6 — Connect
Notifications, templates, email/SMS/WhatsApp/push, announcements, calendar, diary.
Phase 7 — HR
Employee lifecycle, attendance, leave, payroll, appraisal.
Phase 8 — Operations
Library, inventory, hostel, transport, canteen, store, visitor, infirmary.
Phase 9 — Mobile
Parent, teacher/admin, student, pre-admission and driver experiences.
Phase 10 — AI
AI gateway, RAG, lesson plans, assessments, grading, extraction, copilot.
Phase 11 — Analytics
Dashboards, report builder, scheduled reports, warehouse-ready events.
Phase 12 — Hardening
Security, performance, disaster recovery, observability, accessibility, UAT and rollout.
# 21. Recommended Claude Prompt Contract
Use this as the header of every Claude implementation task:
You are implementing a production-grade multi-tenant School Operating System.Rules:1. Do not break existing modules.2. Follow the existing domain model and permission system.3. Every business record is tenant-scoped.4. Every mutation has audit logging.5. Use service/repository/controller boundaries.6. Validate all inputs server-side.7. Add database migrations, seed data and tests with each feature.8. Add loading/empty/error states to every UI.9. Do not hard-code school/branch/academic-year IDs.10. Do not bypass approval or authorization rules.11. Add API documentation and example requests.12. Run unit, integration and end-to-end tests before declaring completion.13. Keep external integrations behind adapters.14. Keep AI behind an AI Gateway.15. Explain changed files, migration impact and rollback plan.
# 22. Claude Task Template
FEATURE: <name>CONTEXT:<existing module and business reason>USER ROLES:<roles>USER STORIES:- As a <role>, I can <action> so that <outcome>.WORKFLOW:1. ...2. ...3. ...DATA:<entities + relationships>PERMISSIONS:<view/create/edit/approve/export rules>API:<endpoint list>UI:<pages/components/states>EVENTS:<events emitted/consumed>INTEGRATIONS:<providers>VALIDATION:<rules>AUDIT:<events to log>TESTS:<unit/integration/e2e cases>DEFINITION OF DONE:<acceptance criteria>
# 23. Navigation / Information Architecture
Global├── Dashboard├── My Work├── Students├── Academics│   ├── Curriculum│   ├── Timetable│   ├── Attendance│   ├── Assignments│   ├── Assessments│   ├── Exams│   └── Gradebook├── Admissions├── Finance├── HR├── LMS├── Communication├── Operations│   ├── Transport│   ├── Hostel│   ├── Library│   ├── Inventory│   ├── Canteen│   ├── Store│   └── Visitor/Security├── Reports & Analytics├── AI Copilot├── Documents└── Settings    ├── Organization    ├── Branch    ├── Academic Year    ├── Users/Roles    ├── Workflows    ├── Integrations    ├── Templates    └── Audit
# 24. No-Missing-Gaps Checklist
## Core platform
□ Multi-tenant isolation
□ Branch/campus support
□ Academic year versioning
□ RBAC + ABAC
□ Audit trail
□ Approval engine
□ Workflow engine
□ Import/export
□ File storage
□ Search
□ Global notifications
□ Feature flags
□ Localization/timezone
□ Accessibility
□ Data retention
□ Backups/restore
## SIS & academics
□ Student lifecycle
□ Guardian/sibling relationships
□ Attendance
□ Timetable
□ Substitution
□ Curriculum mapping
□ Teacher workload
□ Report cards
□ Certificates
□ Student documents
□ Promotion/retention/transfer
□ Alumni
□ Student concerns
□ Student council
□ Achievements
## Finance
□ Fee structures
□ Concessions
□ Invoices
□ Receipts
□ Online payments
□ Offline payments
□ Partial payments
□ Refunds
□ PDC
□ Bank reconciliation
□ Expenses
□ Student loans
□ School store
□ Canteen
□ Accounting-ready ledger
## Admissions
□ Lead capture
□ Lead import
□ Deduplication
□ Lead scoring
□ Pipeline
□ Follow-up
□ Counselor assignment
□ Landing pages
□ Chatbot
□ OTP
□ Application
□ Documents
□ Appointments
□ Payments
□ Campaigns
□ WhatsApp
□ Enrollment conversion
## LMS
□ Course builder
□ Content library
□ Assignments
□ Submissions
□ Question bank
□ Objective exams
□ Online exams
□ Examcell
□ AI paper generation
□ Grading
□ Rubrics
□ Gradebook
□ CBSE/State
□ IB
□ Cambridge
□ Preschool
□ Montessori
□ Higher Ed
□ Holistic reporting
## HR
□ Recruitment
□ Onboarding
□ Employee master
□ Documents
□ Attendance
□ Leave
□ Payroll
□ Compliance fields
□ Appraisal
□ Objectives/weightage
□ Feedback
□ Staff wall
□ Exit
## Communication
□ Email
□ SMS
□ WhatsApp
□ Push
□ Voice
□ Templates
□ Campaigns
□ Scheduling
□ Delivery tracking
□ Retries
□ Consent
□ Quiet hours
□ Announcements
□ Diary
□ Calendar
□ Gallery
## Safety & operations
□ GPS/VTS
□ RFID
□ Visitor
□ Infirmary
□ Emergency alerts
□ Library
□ Inventory
□ Hostel
□ Transport
□ Canteen
□ Store
□ Maintenance
## AI
□ AI gateway
□ Tenant-scoped retrieval
□ Prompt/version management
□ Usage metering
□ Content generation
□ Translation
□ Summarization
□ Document extraction
□ AI grading
□ Question paper generation
□ Lesson plans
□ School copilot
□ Human approval
□ Audit/citations
## Quality
□ Unit tests
□ Integration tests
□ E2E tests
□ Load tests
□ Security tests
□ Backup restore tests
□ Accessibility tests
□ Mobile testing
□ Cross-browser testing
□ UAT scripts
□ Release checklist
# 25. QA & Acceptance Strategy
Test layer
Minimum coverage
Unit
Domain rules, calculations, permissions, validators
Integration
DB transactions, queues, providers, webhooks
E2E
Critical parent/teacher/admin/admission/finance journeys
Security
Tenant escape, IDOR, privilege escalation, file access, rate limiting
Performance
Login, student search, attendance, fee collection, report generation
Mobile
Offline/poor-network states, push, camera/QR, file upload
AI
Prompt injection, data leakage, hallucination, citation, permission tests
UAT
School-level acceptance scripts by role
# 26. Production Deployment
Internet  -> CDN/WAF  -> Load Balancer  -> Next.js frontend + API  -> PostgreSQL primary + replicas  -> Redis  -> Queue workers  -> Object Storage  -> Search  -> ObservabilityCI/CD:Git -> PR checks -> unit/integration -> security scan -> staging -> UAT -> approval -> production
Use blue/green or canary deployment once traffic is meaningful.
Run migrations with backward-compatible changes first.
Maintain feature flags for risky modules.
Create per-tenant backups/exports for enterprise customers.
Use automated health checks and rollback.
# 27. Practical MVP vs Full Parity
Release
Scope
Goal
MVP
Tenant + SIS + Academics + Attendance + Fees + Admissions + Communication
Sell to first schools
V1
LMS + Exams + HR + Reports + Mobile
Operational school suite
V2
Transport + Hostel + Library + Inventory + Canteen + Visitor
Full operations
V3
AI Gateway + AI grading + paper generator + copilot
AI differentiation
V4
Advanced analytics + curriculum engines + enterprise integrations
Large-school/chain readiness
# 28. Recommended Improvements Beyond Functional Parity
One global command/search bar: 'Show students absent today in Grade 8' → permission-aware results.
Unified student 360: academics + attendance + fees + behavior + communication + documents + transport.
Unified parent timeline: every school interaction in chronological order.
No-code workflow builder shared by admissions, finance, HR, concerns and academics.
No-code form builder shared across admissions, surveys, HR and school operations.
AI copilot with citations and action proposals, not just chat.
Real-time operational command center for principal/management.
Data quality center: duplicate people, missing documents, invalid fees, incomplete profiles.
Integration hub with webhooks/API keys and prebuilt connectors.
Enterprise multi-branch benchmarking with privacy-safe aggregated metrics.
# 29. 12-Month Engineering Roadmap
Month
Primary outcome
1
Foundation, auth, tenancy, design system, CI/CD
2
SIS + import + academic setup
3
Attendance + timetable + teacher workflows
4
Admissions CRM + public application portal
5
Finance + payments + receipts
6
Communication hub + mobile parent MVP
7
LMS + content + assignments
8
Exams + gradebook + report cards
9
HR + payroll + appraisal
10
Transport + library + inventory + hostel
11
AI Gateway + assessment/lesson tools + analytics
12
Security hardening + scale + UAT + enterprise integrations
# 30. Definition of Done for the Whole Platform
□ Every module is tenant-aware and permission-controlled.
□ Every critical mutation is audited.
□ Every external integration is adapter-based and retryable.
□ Every financial flow is reconciliable.
□ Every academic year preserves historical data.
□ Every public form has validation, spam protection and rate limits.
□ Every notification has delivery status and failure handling.
□ Every mobile screen handles loading, offline/poor-network, empty and error states.
□ Every AI response is subject to permission, data-scope and safety checks.
□ Every report has a documented metric definition.
□ Every release has migration, rollback and monitoring plans.
□ Critical workflows have automated E2E coverage.
# 31. Source Notes
Primary source reviewed: MyClassBoard Explore All Products and related public product pages. The public catalog lists ERP, Finance, Admission, HR, LMS and Connect modules, while related pages expose Safety & Security, Mobile Apps, curriculum-specific solutions and Ved AI. citeturn0view0turn1search7
Admission Plus documentation was used to expand the workflow beyond the short product-card descriptions, including landing pages, chatbot, counselor chat, lead follow-up, application tracking and campaign communication. citeturn1search1turn1search9
Ved AI documentation was used to expand the AI section, including writing assistance, translation, lesson planning, content extraction, assessment generation and AI-assisted grading. citeturn1search3turn1search5turn1search12
This blueprint is an independent functional architecture. It does not reproduce MyClassBoard's proprietary source code, private APIs, private implementation, copyrighted UI assets or confidential data.
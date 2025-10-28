## For Beck — site

A small static site (HTML/CSS/JS) for sharing memories and actions in Beck’s name. Media and submissions are handled in the browser with a lightweight backend for storage and moderation. No build step is required.

### Sections
- 19 Years — memories and stories
- Action for Change — projects and fundraisers
- Silver Threads — gentle tips and small supports

### Submissions
- Public submit form with optional title, date, credits, and one media file (photo/video/audio).
- Images are compressed client‑side before upload for smoother mobile/iPad experience. A progress bar shows upload status.
- Submissions are hidden until approved.

### Feeds & entries
- Each section lists approved posts in reverse‑date order.
- Cards show media (if present), author, date, and a title. If no title is provided, the first part of the description is used instead.
- Entry pages display the full post with media and metadata.

### Admin
- `approve.html` lists pending items for review. Admins can approve, edit (title, content, author, credits, date, section), or delete.
- Approved items are also listed for quick edits or removal.
- When signed in as an admin, entry pages show inline Edit/Delete controls.

### File handling
- One media file per submission (by design). Images are resized to ~2000px max and saved as high‑quality JPEG when beneficial; video/audio are uploaded as‑is.
- Client‑side progress indicator keeps users informed on slower networks.

### Structure
- `index.html` — home
- `nineteen-years.html`, `action-for-change.html`, `support.html` — section pages
- `entry.html` — single entry view
- `submit.html` — public submission form
- `approve.html` — admin moderation
- `script.js` — all interactive logic
- `style.css` — styles

### Notes
- Works on desktop and mobile browsers (including iPad Safari). If uploads fail, check connectivity and file size (<10 MB).




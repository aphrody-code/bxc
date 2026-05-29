/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, test } from "bun:test";
import { WorldBeybladeScraper } from "../../src/scrapers/worldbeyblade.ts";

// Mock MyBB Profile HTML
const MOCK_PROFILE_HTML = `
<html>
<head>
<title>worldbeyblade.org - Profile of testuser</title>
</head>
<body>
<h2>testuser</h2>
<span class="largetext"><strong>testuser</strong></span>
<img src="uploads/avatars/avatar_123.png" alt="testuser's Avatar" class="avatar" />
<table>
  <tr>
    <td>User Group:</td>
    <td>Super Moderators</td>
  </tr>
  <tr>
    <td>Total Posts:</td>
    <td>1,234 posts (2.5 posts per day)</td>
  </tr>
  <tr>
    <td>Joined:</td>
    <td>2024-01-15</td>
  </tr>
  <tr>
    <td>Last Visit:</td>
    <td>2026-05-29 08:00 AM</td>
  </tr>
  <tr>
    <td>Reputation:</td>
    <td><a href="reputation.php?uid=123">45</a></td>
  </tr>
</table>
<a href="member.php?action=profile&amp;uid=123">Profile Link</a>
</body>
</html>
`;

// Mock MyBB Thread HTML
const MOCK_THREAD_HTML = `
<html>
<head>
<title>worldbeyblade.org - Thread Title</title>
</head>
<body>
<div class="navigation">
  <a href="index.php">worldbeyblade.org</a> &raquo; <a href="forumdisplay.php?fid=2">General Beyblade</a> &raquo; <span class="active">Thread Title</span>
</div>
<span class="thread_title">Thread Title</span>
Pages (3)

<!-- Post 1 -->
<table id="post_9876" class="tborder">
  <tr>
    <td class="trow1">
      <a href="member.php?action=profile&amp;uid=10">AuthorName1</a>
      <span class="post_date">2026-05-29, 07:30 AM</span>
      <div id="pid_9876" class="post_body">
        This is the <strong>first post</strong> content.
      </div>
      <!-- footer -->
    </td>
  </tr>
</table>

<!-- Post 2 -->
<table id="post_9877" class="tborder">
  <tr>
    <td class="trow2">
      <a href="member.php?action=profile&amp;uid=20">AuthorName2</a>
      <span class="post_date">2026-05-29, 07:45 AM</span>
      <div id="pid_9877" class="post_body">
        This is the second post content with a <a href="https://google.com">link</a>.
      </div>
      <!-- footer -->
    </td>
  </tr>
</table>

</body>
</html>
`;

// Mock PM Inbox HTML
const MOCK_INBOX_HTML = `
<html>
<body>
<table>
  <tr class="trow1">
    <td><img src="images/read.png" alt="Read" /></td>
    <td>
      <a href="private.php?action=read&amp;pmid=500" class="subject_old">Hello there</a>
    </td>
    <td>
      <a href="member.php?action=profile&amp;uid=99">FriendUser</a>
    </td>
    <td>
      <span class="smalltext">2026-05-28, 10:15 PM</span>
    </td>
  </tr>
  <tr class="trow2">
    <td><img src="images/unread.png" alt="Unread" /></td>
    <td>
      <strong><a href="private.php?action=read&amp;pmid=501" class="subject_new">Urgent issue</a></strong>
    </td>
    <td>
      <a href="member.php?action=profile&amp;uid=1">Admin</a>
    </td>
    <td>
      <span class="smalltext">2026-05-29, 01:20 AM</span>
    </td>
  </tr>
</table>
</body>
</html>
`;

describe("scrapers/worldbeyblade — offline parsing", () => {
	test("profile parsing", () => {
		const scraper = new WorldBeybladeScraper();
		// Use private parser test via prototype/cast
		const profile = (scraper as any).parseProfileHtml(
			MOCK_PROFILE_HTML,
			"testuser",
			123,
		);

		expect(profile.uid).toBe(123);
		expect(profile.username).toBe("testuser");
		expect(profile.userGroup).toBe("Super Moderators");
		expect(profile.postCount).toBe(1234);
		expect(profile.joinedDate).toBe("2024-01-15");
		expect(profile.lastVisit).toBe("2026-05-29 08:00 AM");
		expect(profile.reputation).toBe(45);
		expect(profile.avatarUrl).toBe(
			"https://worldbeyblade.org/uploads/avatars/avatar_123.png",
		);
	});

	test("thread and post parsing", async () => {
		const scraper = new WorldBeybladeScraper();

		// We mock the page goto and content method by mocking the page object
		const mockPage = {
			goto: async () => ({ status: 200, statusText: "OK", ok: true, url: "" }),
			content: async () => MOCK_THREAD_HTML,
		};
		(scraper as any).httpPage = mockPage;

		const thread = await scraper.getThread(456, 1);

		expect(thread.tid).toBe(456);
		expect(thread.title).toBe("Thread Title");
		expect(thread.forumCategory).toEqual(["General Beyblade"]);
		expect(thread.totalPages).toBe(3);
		expect(thread.currentPage).toBe(1);

		expect(thread.posts.length).toBe(2);
		expect(thread.posts[0].pid).toBe(9876);
		expect(thread.posts[0].authorName).toBe("AuthorName1");
		expect(thread.posts[0].authorUid).toBe(10);
		expect(thread.posts[0].postDate).toBe("2026-05-29, 07:30 AM");
		expect(thread.posts[0].contentMarkdown).toContain(
			"This is the **first post** content.",
		);

		expect(thread.posts[1].pid).toBe(9877);
		expect(thread.posts[1].authorName).toBe("AuthorName2");
		expect(thread.posts[1].authorUid).toBe(20);
		expect(thread.posts[1].postDate).toBe("2026-05-29, 07:45 AM");
		expect(thread.posts[1].contentMarkdown).toContain(
			"This is the second post content with a [link](https://google.com).",
		);
	});

	test("PM inbox parsing", async () => {
		const scraper = new WorldBeybladeScraper();

		const mockPage = {
			goto: async () => ({ status: 200, statusText: "OK", ok: true, url: "" }),
			content: async () => MOCK_INBOX_HTML,
		};
		(scraper as any).httpPage = mockPage;

		const pms = await scraper.getInbox();

		expect(pms.length).toBe(2);

		expect(pms[0].pmid).toBe(500);
		expect(pms[0].title).toBe("Hello there");
		expect(pms[0].senderName).toBe("FriendUser");
		expect(pms[0].senderUid).toBe(99);
		expect(pms[0].date).toBe("2026-05-28, 10:15 PM");
		expect(pms[0].isRead).toBe(true);

		expect(pms[1].pmid).toBe(501);
		expect(pms[1].title).toBe("Urgent issue");
		expect(pms[1].senderName).toBe("Admin");
		expect(pms[1].senderUid).toBe(1);
		expect(pms[1].date).toBe("2026-05-29, 01:20 AM");
		expect(pms[1].isRead).toBe(false);
	});
});

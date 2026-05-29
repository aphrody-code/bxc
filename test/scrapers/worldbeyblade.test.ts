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
import {
	WorldBeybladeScraper,
	parseTournamentsFromHtml,
	calculateMetagameAnalytics,
} from "../../src/scrapers/worldbeyblade/index.ts";

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
<script>var tid = 456;</script>
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
        This is a quote:
        <div class="blockquote">nested quote</div>
        And this is more text after the quote.
      </div>
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

// Mock MyBB Forum HTML
const MOCK_FORUM_HTML = `
<html>
<head>
<title>worldbeyblade.org - General Discussion</title>
<script>var fid = 12;</script>
</head>
<body>
<h1>General Discussion</h1>
Pages (5)

<tr id="thread_1111">
  <td class="trow1">
    <a href="Thread-Bey-Rules" class="subject_old">Beyblade Rules</a>
  </td>
  <td class="trow2">
    <a href="member.php?action=profile&amp;uid=50">BladerOne</a>
  </td>
  <td class="trow1">12</td>
  <td class="trow2">350</td>
  <td class="trow1">
    <span class="lastpost">2026-05-29, 06:00 AM by <a href="member.php?action=profile&amp;uid=80">LastUser</a></span>
  </td>
</tr>

<tr id="thread_2222">
  <td class="trow2">
    <a href="showthread.php?tid=2222" class="subject_new">New Custom Beyblade</a>
  </td>
  <td class="trow1">
    <a href="member.php?action=profile&amp;uid=51">BladerTwo</a>
  </td>
  <td class="trow2">5</td>
  <td class="trow1">120</td>
  <td class="trow2">
    <span class="lastpost">2026-05-29, 07:15 AM by BladerTwo</span>
  </td>
</tr>
</body>
</html>
`;

describe("scrapers/worldbeyblade — offline parsing", () => {
	test("profile parsing", () => {
		const scraper = new WorldBeybladeScraper();
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
		const mockPage = {
			goto: async () => ({ status: 200, statusText: "OK", ok: true, url: "" }),
			content: async () => MOCK_THREAD_HTML,
		};
		(scraper as any).httpPage = mockPage;

		const thread = await scraper.getThread("Beyblade-X-Rules", 1);

		expect(thread.tid).toBe(456);
		expect(thread.title).toBe("Thread Title");
		expect(thread.forumCategory).toEqual(["General Beyblade"]);
		expect(thread.totalPages).toBe(3);
		expect(thread.currentPage).toBe(1);

		expect(thread.posts.length).toBe(2);
		expect(thread.posts[0].pid).toBe(9876);
		expect(thread.posts[0].authorName).toBe("AuthorName1");
		expect(thread.posts[0].authorUid).toBe(10);
		expect(thread.posts[0].contentMarkdown).toContain(
			"This is the **first post** content.",
		);
		expect(thread.posts[1].contentMarkdown).toContain("nested quote");
		expect(thread.posts[1].contentMarkdown).toContain(
			"more text after the quote",
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
		expect(pms[0].isRead).toBe(true);

		expect(pms[1].pmid).toBe(501);
		expect(pms[1].title).toBe("Urgent issue");
		expect(pms[1].isRead).toBe(false);
	});

	test("forum page parsing", async () => {
		const scraper = new WorldBeybladeScraper();
		const mockPage = {
			goto: async () => ({ status: 200, statusText: "OK", ok: true, url: "" }),
			content: async () => MOCK_FORUM_HTML,
		};
		(scraper as any).httpPage = mockPage;

		const forum = await scraper.getForum("General-Discussion", 1);

		expect(forum.fid).toBe(12);
		expect(forum.title).toBe("General Discussion");
		expect(forum.currentPage).toBe(1);
		expect(forum.totalPages).toBe(5);

		expect(forum.threads.length).toBe(2);

		expect(forum.threads[0].tid).toBe(1111);
		expect(forum.threads[0].title).toBe("Beyblade Rules");
		expect(forum.threads[0].slug).toBe("Thread-Bey-Rules");
		expect(forum.threads[0].authorName).toBe("BladerOne");
		expect(forum.threads[0].authorUid).toBe(50);
		expect(forum.threads[0].replies).toBe(12);
		expect(forum.threads[0].views).toBe(350);
		expect(forum.threads[0].lastPostAuthor).toBe("LastUser");
		expect(forum.threads[0].lastPostDate).toBe("2026-05-29, 06:00 AM");

		expect(forum.threads[1].tid).toBe(2222);
		expect(forum.threads[1].title).toBe("New Custom Beyblade");
		expect(forum.threads[1].slug).toBeNull();
		expect(forum.threads[1].authorName).toBe("BladerTwo");
		expect(forum.threads[1].replies).toBe(5);
		expect(forum.threads[1].views).toBe(120);
		expect(forum.threads[1].lastPostAuthor).toBe("BladerTwo");
		expect(forum.threads[1].lastPostDate).toBe("2026-05-29, 07:15 AM");
	});

	test("metagame analytics parsing", () => {
		const mockThreadHtml = `
<html>
<body>
<div class="post_body" id="pid_1001">
  <div class="post_date">May 29, 2026</div>
  1st Place<br>
  Phoenix Wing 3-60 Flat<br>
  2nd Place<br>
  Dran Sword 5-80 Rush<br>
  3rd Place<br>
  Hells Scythe 9-60 Ball
</div>
<div class="post_body" id="pid_1002">
  <div class="post_date">May 29, 2026</div>
  1st Place<br>
  Phoenix Wing 5-60 Flat<br>
  2nd Place<br>
  Cobalt Drake 3-60 Ball<br>
  3rd Place<br>
  Dran Dagger 4-80 Point
</div>
</body>
</html>
		`;

		const { tournaments } = parseTournamentsFromHtml(mockThreadHtml);
		expect(tournaments.length).toBe(2);
		expect(tournaments[0].tournament_id).toBe("pid_1001");
		expect(tournaments[0].podium.first_place[0].blade).toBe("Phoenix Wing");
		expect(tournaments[0].podium.first_place[0].ratchet).toBe("3-60");
		expect(tournaments[0].podium.first_place[0].bit).toBe("Flat");

		const { partRankings } =
			calculateMetagameAnalytics(tournaments);
		const wingRanking = partRankings.find((r) => r.part === "Phoenix Wing");
		expect(wingRanking).toBeDefined();
		expect(wingRanking?.average_score).toBe(3);
		expect(wingRanking?.placements).toBe(2);
	});
});

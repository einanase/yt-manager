/**
 * youtube.js - YouTube API Service Layer with Multi-Account Support
 */

export class YouTubeService {
    constructor() {
        this.clientId = '581945076599-45t9ig7ufolggljcjrutglne1cjnqgqu.apps.googleusercontent.com';
        this.scopes = [
            'https://www.googleapis.com/auth/youtube.force-ssl',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/yt-analytics.readonly'
        ];
        // Store multiple tokens as an array of objects
        // Use v3 key to force a clean state for all users
        this.tokens = JSON.parse(localStorage.getItem('yt_access_tokens_v3')) || [];
        // Ensure all tokens are strings and unique
        this.tokens = [...new Set(this.tokens.filter(t => typeof t === 'string' && t.length > 0))];
        this.isAuthenticated = this.tokens.length > 0;
        this.onAuthChange = null;
    }

    setClientId(id) {
        this.clientId = id;
        localStorage.setItem('yt_client_id', id);
    }

    async addAccount() {
        return new Promise((resolve, reject) => {
            if (!window.google) {
                reject('Google API not loaded');
                return;
            }

            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                scope: this.scopes.join(' '),
                prompt: 'select_account',
                callback: (response) => {
                    console.log('Auth response received:', response);
                    if (response.error) {
                        console.error('Auth error:', response.error, response.error_description);
                        reject(response.error);
                        return;
                    }
                    if (response.access_token) {
                        const newToken = response.access_token;
                        this.isAuthenticated = true;
                        // Clean push: ensure no duplicates
                        if (!this.tokens.includes(newToken)) {
                            this.tokens.push(newToken);
                        }
                        localStorage.setItem('yt_access_tokens_v3', JSON.stringify(this.tokens));
                        if (this.onAuthChange) this.onAuthChange(true);
                        resolve(newToken);
                    } else {
                        console.error('No access_token in response');
                        reject('Auth failed: No token');
                    }
                },
            });
            client.requestAccessToken();
        });
    }

    logout() {
        this.tokens = [];
        this.isAuthenticated = false;
        localStorage.removeItem('yt_access_tokens_v3');
        if (this.onAuthChange) this.onAuthChange(false);
    }

    async fetchAPI(token, endpoint, params = {}, bypassCache = false) {
        const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        
        // Cache Check (5 minutes) - V2 with full token identifier
        const tokenIdent = token.slice(-32) + token.slice(0, 16);
        const cacheKey = `yt_cache_v2_${endpoint}_${JSON.stringify(params)}_${tokenIdent}`;
        
        if (!bypassCache) {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < 5 * 60 * 1000) {
                    console.log(`Using cached data (v2) for ${endpoint}`);
                    return data;
                }
            }
        }

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const data = await res.json();

        if (!res.ok) {
            console.error('API Error Response:', data);
            if (res.status === 401) {
                this.tokens = this.tokens.filter(t => t !== token);
                localStorage.setItem('yt_access_tokens_v3', JSON.stringify(this.tokens));
                if (this.tokens.length === 0) this.isAuthenticated = false;
                throw new Error('Unauthorized');
            }
            if (res.status === 403 && data.error?.message?.includes('quota')) {
                const quotaMsg = 'YouTube APIの「1日の利用制限（クォータ）」を超えました。通常、日本時間の夕方〜夜頃にリセットされます。Google Cloud Consoleの「割り当て」ページで制限を増やすか、リセットを待ってください。';
                alert(quotaMsg);
                throw new Error(quotaMsg);
            }
            const msg = data.error ? data.error.message : 'Unknown API error';
            throw new Error(`API Error ${res.status}: ${msg}`);
        }

        // Save to cache
        sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
        return data;
    }

    async getChannels() {
        console.log('Fetching channels... Authenticated:', this.isAuthenticated, 'Tokens count:', this.tokens.length);
        if (!this.isAuthenticated || this.tokens.length === 0) {
            console.log('Returning sample data (not authenticated)');
            return [
                { id: 'UC1', name: 'Gaming (サンプル)', subscribers: 12500, token: null }
            ];
        }

        let allChannels = [];
        for (const token of this.tokens) {
            try {
                console.log('Fetching with token:', token.substring(0, 10) + '...');
                // Bypass cache for channel listing to ensure we see all new additions correctly
                const data = await this.fetchAPI(token, 'channels', {
                    part: 'snippet,statistics',
                    mine: true
                }, true); // Add a flag to bypass cache if needed, or just change fetchAPI

                if (!data.items || data.items.length === 0) {
                    console.warn('No channels found for this token');
                    continue;
                }

                const channels = data.items.map(item => ({
                    id: String(item.id).trim(), // Enforce string for Set deduplication
                    name: item.snippet.title,
                    subscribers: parseInt(item.statistics.subscriberCount),
                    thumbnail: item.snippet.thumbnails.default.url,
                    token: token
                }));
                allChannels = [...allChannels, ...channels];
            } catch (e) {
                console.error('Failed to fetch channels for a token:', e);
            }
        }
        
        // Deduplicate channels by ID (stricter)
        const uniqueChannels = [];
        const seenIds = new Set();
        for (const channel of allChannels) {
            const normalizedId = String(channel.id).trim();
            if (normalizedId && !seenIds.has(normalizedId)) {
                seenIds.add(normalizedId);
                uniqueChannels.push(channel);
            }
        }
        
        console.log('Total unique channels found (v3):', uniqueChannels.length);
        return uniqueChannels.length > 0 ? uniqueChannels : [
            { id: 'UC-EMPTY', name: 'チャンネルが見つかりません', subscribers: 0, token: null }
        ];
    }

    async getChannelStats(channelId, token) {
        if (!token) return { subscriberCount: 12540 };

        const data = await this.fetchAPI(token, 'channels', {
            part: 'statistics',
            id: channelId
        });
        return {
            subscriberCount: parseInt(data.items[0].statistics.subscriberCount)
        };
    }

    async getLatestVideos(channelId, token) {
        if (!token) return [{ id: 'v1', title: '最新のビデオ', views: 0, likes: 0, comments: 0 }];

        const channelData = await this.fetchAPI(token, 'channels', {
            part: 'contentDetails',
            id: channelId
        });
        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        // Get latest 10 items to allow filtering for public ones
        const playlistItems = await this.fetchAPI(token, 'playlistItems', {
            part: 'contentDetails',
            playlistId: uploadsPlaylistId,
            maxResults: 10
        });

        const videoIds = playlistItems.items.map(i => i.contentDetails.videoId).join(',');
        const videoData = await this.fetchAPI(token, 'videos', {
            part: 'snippet,statistics,status',
            id: videoIds
        });

        return videoData.items
            .filter(item => item.status.privacyStatus === 'public')
            .slice(0, 5)
            .map(item => {
                return {
                    id: item.id,
                    title: item.snippet.title,
                    publishedAt: item.snippet.publishedAt,
                    views: parseInt(item.statistics.viewCount),
                    likes: parseInt(item.statistics.likeCount || 0),
                    comments: parseInt(item.statistics.commentCount || 0)
                };
            });
    }

    async getAnalyticsForVideos(channelId, token, videoIds) {
        if (!token) return {};

        const today = new Date();
        
        try {
            const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
            const params = {
                ids: `channel==${channelId}`,
                startDate: '2020-01-01',
                endDate: today.toISOString().split('T')[0],
                metrics: 'averageViewPercentage', // Start with basic retention only
                dimensions: 'video',
                filters: `video==${videoIds}`
            };
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            console.log('YouTube Analytics Response:', data); // Debug log
            
            if (data.error) {
                console.error('YouTube Analytics API Error:', data.error);
                return {};
            }

            const results = {};
            if (data.rows) {
                data.rows.forEach(row => {
                    results[row[0]] = {
                        retention: row[1] || 0,
                        swipeRate: 0 // Placeholder
                    };
                });
            }
            return results;
        } catch (e) {
            console.error('Analytics fetch failed', e);
            return {};
        }
    }

    async getScheduledUploads(channelId, token) {
        if (!token) return [];

        try {
            // Get the uploads playlist ID (same as getLatestVideos)
            const channelData = await this.fetchAPI(token, 'channels', {
                part: 'contentDetails',
                id: channelId
            });
            const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

            // Get more items (up to 50) to search for scheduled ones
            const playlistItems = await this.fetchAPI(token, 'playlistItems', {
                part: 'contentDetails',
                playlistId: uploadsPlaylistId,
                maxResults: 50
            });

            if (!playlistItems.items || playlistItems.items.length === 0) return [];

            const videoIds = playlistItems.items.map(i => i.contentDetails.videoId).join(',');
            const videoData = await this.fetchAPI(token, 'videos', {
                part: 'snippet,status',
                id: videoIds
            });

            // Filter for videos that have a scheduled publish time (publishAt)
            // and have NOT been published yet (privacyStatus is likely 'private')
            return videoData.items
                .filter(v => v.status && v.status.publishAt)
                .map(v => ({
                    id: v.id,
                    title: v.snippet.title,
                    scheduledTime: v.status.publishAt
                }));
        } catch (e) {
            console.error('Failed to fetch scheduled uploads:', e);
            return [];
        }
    }

    async updateScheduledTime(videoId, token, newTime) {
        const url = new URL('https://www.googleapis.com/youtube/v3/videos');
        url.searchParams.append('part', 'status');

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: videoId,
                status: {
                    publishAt: new Date(newTime).toISOString(),
                    privacyStatus: 'private'
                }
            })
        });
        return res.ok;
    }

    async publishNow(videoId, token) {
        const url = new URL('https://www.googleapis.com/youtube/v3/videos');
        url.searchParams.append('part', 'status');

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: videoId,
                status: {
                    privacyStatus: 'public'
                }
            })
        });
        return res.ok;
    }
}

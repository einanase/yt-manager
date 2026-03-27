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
        // Store multiple tokens as an array of objects: [{ token: '...', email: '...' }]
        this.tokens = JSON.parse(localStorage.getItem('yt_access_tokens')) || [];
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
                scope: 'https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
                prompt: 'select_account', // Always prompt to allow adding another account
                callback: (response) => {
                    if (response.access_token) {
                        const newToken = response.access_token;
                        // Add to tokens list if not already there (simple check)
                        if (!this.tokens.includes(newToken)) {
                            this.tokens.push(newToken);
                        }
                        this.isAuthenticated = true;
                        localStorage.setItem('yt_access_tokens', JSON.stringify(this.tokens));
                        if (this.onAuthChange) this.onAuthChange(true);
                        resolve(newToken);
                    } else {
                        reject('Auth failed');
                    }
                },
            });
            client.requestAccessToken();
        });
    }

    logout() {
        this.tokens = [];
        this.isAuthenticated = false;
        localStorage.removeItem('yt_access_tokens');
        if (this.onAuthChange) this.onAuthChange(false);
    }

    async fetchAPI(token, endpoint, params = {}) {
        const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (res.status === 401) {
            // Token expired, remove it
            this.tokens = this.tokens.filter(t => t !== token);
            localStorage.setItem('yt_access_tokens', JSON.stringify(this.tokens));
            if (this.tokens.length === 0) this.isAuthenticated = false;
            throw new Error('Unauthorized');
        }

        return await res.json();
    }

    async getChannels() {
        if (!this.isAuthenticated) {
            return [
                { id: 'UC1', name: 'Gaming (サンプル)', subscribers: 12500, token: null }
            ];
        }

        let allChannels = [];
        for (const token of this.tokens) {
            try {
                const data = await this.fetchAPI(token, 'channels', {
                    part: 'snippet,statistics',
                    mine: true
                });

                const channels = data.items.map(item => ({
                    id: item.id,
                    name: item.snippet.title,
                    subscribers: parseInt(item.statistics.subscriberCount),
                    thumbnail: item.snippet.thumbnails.default.url,
                    token: token // Tie channel to token for subsequent calls
                }));
                allChannels = [...allChannels, ...channels];
            } catch (e) {
                console.error('Failed to fetch channels for a token', e);
            }
        }
        return allChannels;
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

        const data = await this.fetchAPI(token, 'search', {
            part: 'snippet',
            forMine: true,
            type: 'video',
            maxResults: 10
        });

        const ids = data.items.map(i => i.id.videoId).join(',');
        const videoDetails = await this.fetchAPI(token, 'videos', {
            part: 'snippet,status',
            id: ids
        });

        return videoDetails.items
            .filter(v => v.status.publishAt)
            .map(v => ({
                id: v.id,
                title: v.snippet.title,
                scheduledTime: v.status.publishAt
            }));
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

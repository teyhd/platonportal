import pkg from "plugnmeet-sdk-js";
import { mlog } from "./logs.js";
import { log } from "console";
const { PlugNmeet } = pkg;

const pnm = new PlugNmeet(
  'https://meet.platoniks.ru',
  process.env.MEETKEY,
  process.env.MEETSECR
);
function parseRoomBoolean(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
}

export function readRoomAccess(roomInfo) {
    try {
        const metadata = typeof roomInfo?.metadata === 'string'
            ? JSON.parse(roomInfo.metadata)
            : roomInfo?.metadata;
        const access = typeof metadata?.extra_data === 'string'
            ? JSON.parse(metadata.extra_data)
            : metadata?.extra_data;
        const pub = parseRoomBoolean(access?.pub);
        const needAuth = parseRoomBoolean(access?.need_auth);
        if (pub === null || needAuth === null) return null;

        const owner = access?.portal_owner;
        if (!Number.isSafeInteger(owner) || owner < 1) {
            // Legacy room metadata did not capture edits made after creation.
            return { pub: false, need_auth: true, owner: null };
        }
        const occurrence = access?.portal_occurrence;
        return { pub, need_auth: needAuth, owner,
            ...(typeof occurrence === 'string' && /^[a-f0-9]{64}$/.test(occurrence) ? { occurrence } : {}) };
    } catch {
        return null;
    }
}

export async function get_active_room(room_id) {
    const status = await pnm.isRoomActive({ room_id });
    if (status.status !== true || typeof status.is_active !== 'boolean') {
        throw new Error('Room status unavailable');
    }
    if (!status.is_active) return null;

    const details = await pnm.getActiveRoomInfo({ room_id });
    if (details.status !== true || details.room?.room_info?.room_id !== room_id) {
        throw new Error('Room details unavailable');
    }
    return details.room;
}

export async function create_room(room_id, usr_name, acc) {
    return pnm.createRoom(
            {"room_id": room_id,
                "empty_timeout": 20,
                        "metadata": {
                        "room_title": `${usr_name}`,
                        "welcome_message": "V.CALL - Онлайн уроки",
                        "extra_data": JSON.stringify(acc),
                        "webhook_url": "https://platoniks.ru/vcalllog",
                        "logout_url": "https://platoniks.ru/",
                        "room_features": {
                        "allow_webcams": true,
                        "mute_on_start": false,
                        "allow_screen_share": true,
                        "allow_rtmp": true,
                        "admin_only_webcams": false,
                        "allow_view_other_webcams": true,
                        "allow_view_other_users_list": true,
                        "allow_polls": true,
                        "enable_analytics": true,
                        "allow_virtual_bg": false,
                        "allow_raise_hand": true,
                        "auto_gen_user_id": true,
                        "room_duration": 0,
                        "recording_features": {
                            "is_allow": false,
                            "is_allow_cloud": false,
                            "is_allow_local": false,
                            "enable_auto_cloud_recording": false
                        },
                        "chat_features": {
                            "allow_chat": true,
                            "allow_file_upload": true
                        },
                        "shared_note_pad_features": {
                            "allowed_shared_note_pad": true
                        },
                        "whiteboard_features": {
                            "allowed_whiteboard": true
                        },
                        "external_media_player_features": {
                            "allowed_external_media_player": true
                        },
                        "waiting_room_features": {
                            "is_active": false
                        },
                        "breakout_room_features": {
                            "is_allow": true,
                            "allowed_number_rooms": 2
                        },
                        "display_external_link_features": {
                            "is_allow": true
                        },
                        "ingress_features": {
                            "is_allow": true
                        },
                        "speech_to_text_translation_features": {
                            "is_allow": true,
                            "is_allow_translation": true
                        },
                        "end_to_end_encryption_features": {
                            "is_enabled": false
                        }
                        },
                        "default_lock_settings": {
                        "lock_microphone": false,
                        "lock_webcam": false,
                        "lock_screen_sharing": false,
                        "lock_whiteboard": false,
                        "lock_shared_notepad": false,
                        "lock_chat": false,
                        "lock_chat_send_message": false,
                        "lock_chat_file_share": false,
                        "lock_private_chat": false
                        }
                        
            }
            }
    );
}

export async function get_link(room_id,usr_name,usr_id,admin,acc={pub:true,need_auth:false}){
    let res = await pnm.getJoinToken({
                "room_id": room_id,
                "user_info": {
                    "name": usr_name,
                    "user_id": usr_id,
                    "is_admin": admin,
                    "is_hidden": false,
                    "user_metadata": {
                        "preferred_lang":"ru-RU",
                         "extra_data": JSON.stringify(acc),
                    //"profile_pic": "https://profile.pic/im.jpg",
                        "lock_settings": {
                            "lock_microphone": false,
                            "lock_webcam": false,
                            "lock_screen_sharing": false,
                            "lock_chat": false,
                            "lock_chat_send_message": false,
                            "lock_chat_file_share": false
                        }
                    }
                }
    })
    if (res.status !== true || typeof res.token !== 'string' || !res.token) {
        throw new Error('Conference join link unavailable');
    }
    const custom = {
        custom_css_url: "https://platoniks.ru/pgm/plugnmeet.css?v=1",
    };
   
    const link = new URL('https://meet.platoniks.ru/');
    link.searchParams.set('access_token', res.token);
    link.searchParams.set('custom_design', JSON.stringify(custom));
    return { link: link.href };
}


export async function rooms_info() {
    const result = await pnm.getActiveRoomsInfo();
    if (result.status === false && result.msg?.trim?.().toLowerCase() === 'no active room found') {
        return { status: true, rooms: [] };
    }
    if (result.status !== true || (result.rooms !== undefined && !Array.isArray(result.rooms))) {
        throw new Error('Conference room list unavailable');
    }
    return { status: true, rooms: result.rooms ?? [] };
}

export async function get_analytic(room_id) {
    let ans = await pnm.fetchAnalytics({
        "room_ids": [room_id],
        "from": 0,
        "limit": 1,
        "order_by": "DESC"
        })
        mlog(ans);
        mlog(ans.result)
        console.dir(ans.result.analytics_list)
        let result = await pnm.getAnalyticsDownloadToken({"file_id": ans.result.analytics_list[0].file_id})
        result = `https://meet.platoniks.ru/download/analytics/${result.token}`
        return result
}


export async function close_room(room_id) {
    return await pnm.endRoom({"room_id": room_id})
}

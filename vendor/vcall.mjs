import pkg from "plugnmeet-sdk-js";
import { mlog } from "./logs.js";
import { log } from "console";
const { PlugNmeet } = pkg;

const pnm = new PlugNmeet(
  'https://meet.platoniks.ru',
  process.env.MEETKEY,
  process.env.MEETSECR
);
export async function openroom(room_id,usr_name,usr_id,admin) {
    let result = await pnm.isRoomActive({"room_id": room_id})
    console.log(result);
    
    if (result.is_active) {
        return await get_link(room_id,usr_name,usr_id,admin)
     //Получили активную комнату
    }
     else {//Создать
        let result = await pnm.createRoom(
            {"room_id": room_id,
                "empty_timeout": 20,
                        "metadata": {
                        "room_title": `${usr_name}`,
                        "welcome_message": "V.CALL - Онлайн уроки",
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
                        "auto_gen_user_id": false,
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
        )

        mlog(result);
        console.dir(result);
        return await get_link(room_id,usr_name,usr_id,admin)
        
    }
   
}

//openroom('VCALL')
export async function get_link(room_id,usr_name,usr_id,admin){
    let res = await pnm.getJoinToken({
                "room_id": room_id,
                "user_info": {
                    "name": usr_name,
                    "user_id": usr_id,
                    "is_admin": admin,
                    "is_hidden": false,
                    "user_metadata": {
                        "preferred_lang":"ru-RU",
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
    const custom = {
        custom_css_url: "https://platoniks.ru/pgm/plugnmeet.css?v=1",
    };
   
    res.link = `https://meet.platoniks.ru/?access_token=${res.token}&custom_design=${encodeURIComponent(JSON.stringify(custom))}`;//`https://meet.platoniks.ru/?access_token=${res.token}&custom_design={"custom_css_url":"https://platoniks.ru/pgm/plugnmeet.css"}`
    return res
}


export async function rooms_info() {
    return await pnm.getActiveRoomsInfo()
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
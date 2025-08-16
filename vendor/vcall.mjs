import pkg from "plugnmeet-sdk-js";
const { PlugNmeet } = pkg;

const pnm = new PlugNmeet(
  'https://meet.platoniks.ru',
  process.env.MEETKEY,
  process.env.MEETSECR
);
export async function openroom(room_id,usr_name,usr_id,admin) {
    let result = await pnm.isRoomActive({"room_id": room_id})
    if (result.is_active) {
        return await get_link(room_id,usr_name,usr_id,admin)
     //Получили активную комнату
    }
     else {//Создать
        let result = await pnm.createRoom(
            {"room_id": room_id,
                        "metadata": {
                        "room_title": "V.CALL",
                        "welcome_message": "Онлайн уроки",
                        "room_features": {
                        "allow_webcams": true,
                        "mute_on_start": true,
                        "allow_screen_share": true,
                        "allow_rtmp": true,
                        "admin_only_webcams": false,
                        "allow_view_other_webcams": true,
                        "allow_view_other_users_list": true,
                        "allow_polls": true,
                        "enable_analytics": true,
                        "allow_virtual_bg": true,
                        "allow_raise_hand": true,
                        "auto_gen_user_id": false,
                        "room_duration": 0,
                        "recording_features": {
                            "is_allow": true,
                            "is_allow_cloud": true,
                            "is_allow_local": true,
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
                        "lock_screen_sharing": true,
                        "lock_whiteboard": true,
                        "lock_shared_notepad": true,
                        "lock_chat": false,
                        "lock_chat_send_message": false,
                        "lock_chat_file_share": false,
                        "lock_private_chat": false
                        }
                        
            }
            }
        )

        console.log(result);
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
    res.link = `https://meet.platoniks.ru/?access_token=${res.token}`
    return res
}

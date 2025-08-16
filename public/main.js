  $(document).ready(function(){
            
    $( "#close" ).click(function() {
      event.preventDefault();
    })
    $( "#btnlogin" ).click(function() {
      //M.toast({html: 'Пожалуйста, заполните содержание', classes: '#ef5350 red lighten-1 rounded'});
      event.preventDefault();
      if ($( "#pass" ).val()!=''){
       // $( "#btnl" ).submit();
        let tosend = $( "#pass" ).val();
        $.get( "/auth", {pin: tosend} )
        .done(function( data ) {
          console.log( "Data Loaded: " + data );
            if (data=='ok'){
            M.toast({html: 'Авторизация - успешно!', classes: '#26a69a teal lighten-1 rounded'});
            reload(true);
          } else {
            M.toast({html: 'Неверный логин! Повторите попытку!', classes: '#ef5350 red lighten-1 rounded'});
            $( "#pass" ).val('');
          }
        });
        //console.log( "Handler for .click() called." );
      } else {
        M.toast({html: 'Пожалуйста, введите логин!', classes: '#ef5350 red lighten-1 rounded'});
      }    
    });

    $( "#logoutBtn" ).click(function() {
      //M.toast({html: 'Пожалуйста, заполните содержание', classes: '#ef5350 red lighten-1 rounded'});
      event.preventDefault();
      logout();
    });
    
    function logout(){
      M.toast({html: 'Выход из аккаунта', classes: '#ef5350 red lighten-1 rounded'});
      $.get( "/logout");
      reload(true);
    }

    function reload(p){
      if (p) setTimeout(reload, 50);
      else location.reload();
    }

    
  });

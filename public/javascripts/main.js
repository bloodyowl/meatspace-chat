define(['jquery', './base/transform', 'gumhelper', './base/videoShooter', 'fingerprint', 'md5', 'moment', 'favico', 'waypoints'],
  function ($, transform, gumHelper, VideoShooter, Fingerprint, md5, moment, Favico) {
  'use strict';

  if (/liveDebug/.test(window.location.search)) {
    window.liveDebug = true;
  }

  var html = $('html');
  var body = $('body');
  var addChatForm = $('#add-chat-form');
  var addChatBlocker = $('#add-chat-blocker');
  var addChat = $('#add-chat');
  var chatList = $('.chats ul');
  var chatsContainer = $('.chats');
  var footer = $('#footer');
  var charCounter = $('#counter');
  var userId = $('#userid');
  var menu = $('#menu-toggle .menu');
  var fp = $('#fp');
  var svg = $(null);
  var isPosting = false;
  var canSend = true;
  var muteText = body.data('mute');
  var fingerprint = new Fingerprint({ canvas: true }).get();
  var mutedArr = JSON.parse(localStorage.getItem('muted')) || [];
  var socket = io.connect(location.protocol + '//' + location.hostname +
    (location.port ? ':' + location.port : ''));
  var videoShooter;
  var CHAT_LIMIT = 25;
  var CHAR_LIMIT = 250;

  // set up tab notifications for unread messages
  var favicon = new Favico({
    animation: 'none',
    position: 'up left'
  });

  var pageHidden = 'hidden';
  var pageVisibilityChange = 'visibilitychange';

  if (typeof document.hidden === 'undefined') {
    ['webkit', 'moz', 'ms'].some(function (prefix) {
      var prop = prefix + 'Hidden';
      if (typeof document[prop] !== 'undefined') {
        pageHidden = prop;
        pageVisibilityChange = prefix + 'visibilitychange';
        return true;
      }
    });
  }

  var unreadMessages = 0;

  var handleVisibilityChange = function () {
    if (!document[pageHidden]) {
      unreadMessages = 0;
      favicon.badge(0);
    }
  };

  var updateNotificationCount = function () {
    if (document[pageHidden]) {
      unreadMessages += 1;
      favicon.badge(unreadMessages);
    }
  };

  var isMuted = function (fingerprint) {
    return mutedArr.indexOf(fingerprint) !== -1;
  };

  var debug = function () {
    if (window.liveDebug) {
      console.log.apply(console, arguments);
    }
  };

  var setupWaypoints = function (rawLi) {
    var li = $(rawLi);
    li.waypoint(function (direction) {
      li.toggleClass('out-of-view', direction === 'down');
    }, {
      offset: function () {
        return -li.height();
      }
    });
    li.waypoint(function (direction) {
      li.toggleClass('out-of-view', direction === 'up');
    }, {
      offset: '100%'
    });
  };

  var renderChat = function (c) {
    debug("Rendering chat: key='%s' fingerprint='%s' message='%s' created='%s' imageMd5='%s'",
      c.chat.key,
      c.chat.value.fingerprint,
      c.chat.value.message,
      c.chat.value.created,
      md5(c.chat.value.media));
    var renderFP = c.chat.value.fingerprint;

    if (!isMuted(renderFP)) {
      var img = new Image();
      var onComplete = function () {
        // Don't want duplicates and don't want muted messages
        if (body.find('li[data-key="' + c.chat.key + '"]').length === 0 &&
            !isMuted(renderFP)) {

          var li = document.createElement('li');
          li.dataset.action = 'chat-message';
          li.dataset.key = c.chat.key;
          li.dataset.fingerprint = renderFP;
          li.appendChild(img);

          // This is likely your own fingerprint so you don't mute yourself. Unless you're weird.
          if (userId.val() !== renderFP) {
            updateNotificationCount();

            var btn = document.createElement('button');
            btn.textContent = muteText;
            btn.className = 'mute';
            li.appendChild(btn);
          }

          var message = document.createElement('p');
          message.textContent = c.chat.value.message;
          message.innerHTML = transform(message.innerHTML);
          li.appendChild(message);

          var createdDate = moment(new Date(c.chat.value.created));
          var timestamp = document.createElement('time');
          timestamp.setAttribute('datetime', createdDate.toISOString());
          timestamp.textContent = createdDate.format('LT');
          timestamp.className = 'timestamp';
          li.appendChild(timestamp);

          var size = addChat.is(":visible") ? addChat[0].getBoundingClientRect().bottom : $(window).innerHeight();
          var last = chatList[0].lastChild;
          var bottom = last ? last.getBoundingClientRect().bottom : 0;
          var follow = bottom < size + 50;

          chatList.append(li);
          setupWaypoints(li);
          debug('Appended chat %s', c.chat.key);

          // if scrolled to bottom of window then scroll the new thing into view
          // otherwise, you are reading the history... allow user to scroll up.
          if (follow) {
            var children = chatList.children();
            var toRemove = children.length - CHAT_LIMIT;
            var dyingNode;
            for (var i = 0; i < toRemove; i ++) {
              dyingNode = children.eq(i);
              dyingNode.waypoint('destroy');
              dyingNode.remove();
            }

            if (toRemove > 1) {
              // if we've removed more than one chat, then the vertical height of the chats has
              // changed (since we've only added one chat). Refresh waypoints to make gifs appear
              // properly
              $.waypoints('refresh');
            }

            li.scrollIntoView();
          }
        }
      };

      img.onload = onComplete;
      img.onerror = onComplete;
      img.src = c.chat.value.media;
    }
  };

  var getScreenshot = function (callback, numFrames, interval, progressCallback) {
    if (videoShooter) {
      videoShooter.getShot(callback, numFrames, interval, progressCallback);
    } else {
      debug('Failed to install videoShooter');
      callback('');
    }
  };

  var disableVideoMode = function () {
    addChatForm.hide();
    footer.hide();
    chatsContainer.addClass('lean');
  };

  var progressCircleTo = function (progressRatio) {
    var circle = $('path#arc');

    var thickness = 10;
    var angle = progressRatio * (360 + (thickness / 2)); // adding thickness accounts for overlap
    var offsetX = 128 / 2;
    var offsetY = 64 / 2;
    var radius = offsetY - (thickness / 2);

    var radians = (angle / 180) * Math.PI;
    var x = offsetX + Math.cos(radians) * radius;
    var y = offsetY + Math.sin(radians) * radius;
    var d;

    if (progressRatio === 0) {
      d = 'M0,0 M ' + x + ' ' + y;
    } else {
      d = circle.attr('d') + ' L ' + x + ' ' + y;
    }
    circle.attr('d', d).attr('stroke-width', thickness);
  };

  $.get('/ip', function (data) {
    fp.val(fingerprint);
    userId.val(md5(fingerprint + data.ip));
  });

  if (navigator.getMedia) {
    svg = $('<svg class="progress" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 128 64" preserveAspectRatio="xMidYMid" hidden><path d="M0,0 " id="arc" fill="none" stroke="rgba(226,38,97,0.8)" /></svg>');

    footer.prepend(svg);

    gumHelper.startVideoStreaming(function callback(err, stream, videoElement) {
      if (err) {
        disableVideoMode();
      } else {
        videoElement.width = 135;
        videoElement.height = 101;
        footer.prepend(videoElement);
        videoElement.play();
        videoShooter = new VideoShooter(videoElement);
        addChatForm.click();
      }
    });
  } else {
    disableVideoMode();
  }

  socket.on('message', function (data) {
    debug("Incoming chat key='%s'", data.chat.key);
    renderChat(data);
  });

  body.on('click', '.mute', function (ev) {
    var self = $(this);
    var fp = self.parent('[data-fingerprint]').data('fingerprint');

    if (!isMuted(fp)) {
      debug('Muting %s', fp);
      mutedArr.push(fp);
      localStorage.setItem('muted', JSON.stringify(mutedArr));
      var userMessages = $('.chats li[data-action="chat-message"]').filter(function() {
        // using filter because we have no guarantee of fingerprint formatting, and if we tried to
        // use an attribute selector, it could be XSS'd to some extent
        return $(this).data('fingerprint') === fp;
      });
      userMessages.waypoint('destroy');
      userMessages.remove();

      $.waypoints('refresh');
    }
  });

  menu.parent().click(function () {
    menu.toggle();
  });

  body.on('click', '#unmute', function (ev) {
    debug('clearing mutes');
    localStorage.clear();
    mutedArr = [];
  });

  addChatForm.on('keydown', function (ev) {
    if (ev.keyCode === 13) {
      ev.preventDefault();
      addChatForm.submit();
    }
  }).on('keyup', function (ev) {
    charCounter.text(CHAR_LIMIT - addChat.val().length);
  }).on('submit', function (ev) {
    ev.preventDefault();

    var self = $(ev.target);
    addChat.prop('readonly', true);

    if (!isPosting) {
      if (!canSend) {
        alert('please wait a wee bit...');
        addChat.prop('readonly', false);
      }

      if (canSend) {
        canSend = false;
        addChatBlocker.removeClass('hidden');
        isPosting = true;

        setTimeout(function () {
          canSend = true;
        }, 5000);

        progressCircleTo(0);

        svg.attr('class', 'progress visible');

        getScreenshot(function (pictureData) {
          var submissionData = $.extend(formValues(self.find('.message-content input')), { picture: pictureData });

          svg.attr('class', 'progress');

          debug('Sending chat');
          $.post('/add/chat', submissionData, function () {

          }).error(function (data) {
            alert(data.responseJSON.error);
          }).always(function (data) {
            addChat.prop('readonly', false);
            addChat.val('');
            charCounter.text(CHAR_LIMIT);
            isPosting = false;
            addChatBlocker.addClass('hidden');
          });
        }, 10, 0.2, function (captureProgress) {
          progressCircleTo(captureProgress);
        });
      }
    }
  });

  $(document).on('keydown', function (event) {
    if (!hasModifiersPressed(event) && event.target !== addChat[0]) {
      addChat.focus();
    }
  });

  $(document).on(pageVisibilityChange, handleVisibilityChange);

  function formValues(elements) {
    return elements.toArray().reduce(function (o, input) {
      o[input.name] = input.value;
      return o;
    }, {});
  }

  function hasModifiersPressed(event) {
    // modifiers exclude shift since it's often used in normal typing
    return (event.altKey || event.ctrlKey || event.metaKey);
  }
});
